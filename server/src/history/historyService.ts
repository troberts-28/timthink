import { readFile, stat } from "node:fs/promises";
import type { DocsStore } from "../docs/store.js";
import { docHash } from "../reviews/paths.js";
import { resolveInsideRoot } from "../safePath.js";
import type { SessionRecord } from "../sessions/sessionStore.js";
import { type Attribution, type SnapshotView, UNKNOWN_AUTHOR } from "./attribution.js";
import { type HumanWrite, type SnapshotEntry, SnapshotStore, shortHash } from "./snapshotStore.js";

export const SNAPSHOT_DEBOUNCE_MS = 800;
export const ATTRIBUTION_WINDOW_MS = 10_000;
const HUB_WRITE_TTL_MS = 60_000;
const BULK_CONCURRENCY = 8;

export interface WriterLookup {
  writerNear(docPath: string, atMs: number, windowMs: number): SessionRecord | null;
}

export interface HistoryServiceOptions {
  docsRoot: string;
  store: DocsStore;
  sessions: WriterLookup;
  keepHashes: (docPath: string) => ReadonlySet<string>;
  readOnly?: boolean;
  onSnapshot?: (docPath: string, entry: SnapshotEntry) => void;
  debounceMs?: number;
  cap?: number;
  log?: (message: string) => void;
}

export interface BulkSnapshotStats {
  docs: number;
  saved: number;
  durationMs: number;
}

interface HubWrite {
  shortHash: string;
  name: string;
  expiresAt: number;
}

export class HistoryService {
  readonly snapshots: SnapshotStore;
  private readonly hubWrites = new Map<string, HubWrite>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly debounceMs: number;

  constructor(private readonly options: HistoryServiceOptions) {
    this.snapshots = new SnapshotStore(options.docsRoot, options.cap);
    this.debounceMs = options.debounceMs ?? SNAPSHOT_DEBOUNCE_MS;
  }

  recordHubWrite(docPath: string, raw: string, name: string): void {
    this.hubWrites.set(docPath, { shortHash: shortHash(docHash(raw)), name, expiresAt: Date.now() + HUB_WRITE_TTL_MS });
  }

  schedule(docPaths: Iterable<string>): void {
    for (const docPath of docPaths) {
      const pending = this.timers.get(docPath);
      if (pending) clearTimeout(pending);
      const timer = setTimeout(() => {
        this.timers.delete(docPath);
        this.snapshotNow(docPath).catch((error: unknown) => this.options.log?.(`snapshot failed: ${String(error)}`));
      }, this.debounceMs);
      timer.unref();
      this.timers.set(docPath, timer);
    }
  }

  snapshotNow(docPath: string): Promise<SnapshotEntry | null> {
    return this.serialised(docPath, () => this.capture(docPath));
  }

  async snapshotAll(): Promise<BulkSnapshotStats> {
    const started = performance.now();
    const docs = this.options.readOnly ? [] : this.options.store.allDocs().map((doc) => doc.path);
    let saved = 0;
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let position = next++; position < docs.length; position = next++) {
        const docPath = docs[position];
        if (docPath && (await this.needsSnapshot(docPath)) && (await this.snapshotNow(docPath))) saved += 1;
      }
    };
    await Promise.all(Array.from({ length: BULK_CONCURRENCY }, worker));
    return { docs: docs.length, saved, durationMs: performance.now() - started };
  }

  async list(docPath: string): Promise<SnapshotView[]> {
    const entries = await this.snapshots.list(docPath);
    const views = await Promise.all(entries.map((entry) => this.view(docPath, entry)));
    return views.reverse();
  }

  async findByHash(docPath: string, hash: string): Promise<SnapshotView | null> {
    const entry = (await this.snapshots.list(docPath)).findLast((candidate) => candidate.shortHash === shortHash(hash));
    return entry ? this.view(docPath, entry) : null;
  }

  read(docPath: string, id: string): Promise<string | null> {
    return this.snapshots.read(docPath, id);
  }

  close(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private async needsSnapshot(docPath: string): Promise<boolean> {
    const hash = this.options.store.contentOf(docPath)?.hash;
    if (!hash) return false;
    return (await this.snapshots.latest(docPath))?.shortHash !== shortHash(hash);
  }

  private async capture(docPath: string): Promise<SnapshotEntry | null> {
    if (this.options.readOnly) return null;
    const absolute = await resolveInsideRoot(this.options.docsRoot, docPath).catch(() => null);
    if (!absolute) return null;
    const [raw, stats] = await Promise.all([
      readFile(absolute, "utf8").catch(() => null),
      stat(absolute).catch(() => null),
    ]);
    if (raw === null || !stats) return null;
    const entry = await this.snapshots.save(docPath, raw, {
      at: stats.mtime,
      humanWrite: this.takeHubWrite(docPath, raw),
      keepHashes: this.options.keepHashes(docPath),
    });
    if (entry) this.options.onSnapshot?.(docPath, entry);
    return entry;
  }

  private takeHubWrite(docPath: string, raw: string): HumanWrite | null {
    const write = this.hubWrites.get(docPath);
    if (!write || write.expiresAt < Date.now()) return null;
    if (write.shortHash !== shortHash(docHash(raw))) return null;
    this.hubWrites.delete(docPath);
    return { by: "human", name: write.name };
  }

  private async view(docPath: string, entry: SnapshotEntry): Promise<SnapshotView> {
    return { ...entry, attribution: await this.attribute(docPath, entry) };
  }

  private async attribute(docPath: string, entry: SnapshotEntry): Promise<Attribution> {
    const human = await this.snapshots.humanWrite(docPath, entry.id);
    if (human) return { kind: "human", name: human.name };
    const session = this.options.sessions.writerNear(docPath, Date.parse(entry.at), ATTRIBUTION_WINDOW_MS);
    return session ? { kind: "claude", sessionId: session.id, sessionTitle: session.title } : UNKNOWN_AUTHOR;
  }

  private serialised<T>(docPath: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(docPath) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.catch(() => null);
    this.queues.set(docPath, settled);
    void settled.then(() => {
      if (this.queues.get(docPath) === settled) this.queues.delete(docPath);
    });
    return next;
  }
}
