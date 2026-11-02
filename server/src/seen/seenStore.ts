import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../reviews/atomicWrite.js";

export const SEEN_FILE = "seen.json";

const seenMarkSchema = z.object({ hash: z.string().min(1), at: z.string() });

const seenEntrySchema = seenMarkSchema.extend({ previous: seenMarkSchema.nullable().default(null) });

const seenFileSchema = z.object({
  version: z.literal(1),
  initialisedAt: z.string(),
  docs: z.record(z.string(), seenEntrySchema),
  threads: z.record(z.string(), z.string()),
});

export type SeenMark = z.infer<typeof seenMarkSchema>;
export type SeenEntry = z.infer<typeof seenEntrySchema>;
export type SeenFile = z.infer<typeof seenFileSchema>;

export interface DocHash {
  path: string;
  hash: string;
}

export interface SeenStoreOptions {
  stateDir: string;
  now?: () => string;
  log?: (message: string) => void;
}

function threadKey(docPath: string, threadId: string): string {
  return `${docPath}#${threadId}`;
}

export class SeenStore {
  private state: SeenFile | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly now: () => string;

  constructor(private readonly options: SeenStoreOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get filePath(): string {
    return path.join(this.options.stateDir, SEEN_FILE);
  }

  get initialisedAt(): string {
    return this.current().initialisedAt;
  }

  async init(currentDocs: readonly DocHash[]): Promise<{ created: boolean }> {
    const loaded = await this.load();
    if (loaded) {
      this.state = loaded;
      return { created: false };
    }
    const at = this.now();
    this.state = {
      version: 1,
      initialisedAt: at,
      docs: Object.fromEntries(currentDocs.map(({ path: docPath, hash }) => [docPath, { hash, at, previous: null }])),
      threads: {},
    };
    await this.persist();
    return { created: true };
  }

  get(docPath: string): SeenEntry | null {
    return this.current().docs[docPath] ?? null;
  }

  threadReadAt(docPath: string, threadId: string): string | null {
    return this.current().threads[threadKey(docPath, threadId)] ?? null;
  }

  keepHashes(docPath: string): Set<string> {
    const entry = this.get(docPath);
    return new Set([entry?.hash, entry?.previous?.hash].filter((hash): hash is string => Boolean(hash)));
  }

  async markSeen(docPath: string, hash: string): Promise<SeenEntry> {
    const state = this.current();
    const existing = state.docs[docPath];
    const at = this.now();
    const previous =
      existing && existing.hash !== hash ? { hash: existing.hash, at: existing.at } : (existing?.previous ?? null);
    const entry: SeenEntry = { hash, at, previous };
    state.docs[docPath] = entry;
    await this.persist();
    return entry;
  }

  async markUnseen(docPath: string): Promise<SeenEntry | null> {
    const state = this.current();
    const existing = state.docs[docPath];
    if (!existing) return null;
    if (existing.previous) state.docs[docPath] = { ...existing.previous, previous: null };
    else delete state.docs[docPath];
    for (const key of Object.keys(state.threads)) {
      if (key.startsWith(`${docPath}#`)) delete state.threads[key];
    }
    await this.persist();
    return state.docs[docPath] ?? null;
  }

  async markThreadRead(docPath: string, threadId: string): Promise<void> {
    this.current().threads[threadKey(docPath, threadId)] = this.now();
    await this.persist();
  }

  private current(): SeenFile {
    if (!this.state) throw new Error("SeenStore used before init()");
    return this.state;
  }

  private async load(): Promise<SeenFile | null> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch {
      return null;
    }
    try {
      const parsed = seenFileSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    } catch {}
    const aside = `${this.filePath}.corrupt-${Date.now()}`;
    await rename(this.filePath, aside).catch(() => {});
    this.options.log?.(`seen.json was unreadable; moved it to ${aside} and started fresh`);
    return null;
  }

  private persist(): Promise<void> {
    const snapshot = `${JSON.stringify(this.current(), null, 2)}\n`;
    this.writing = this.writing
      .then(async () => {
        await mkdir(this.options.stateDir, { recursive: true });
        await writeFileAtomic(this.filePath, snapshot);
      })
      .catch((error: unknown) => this.options.log?.(`couldn't save seen.json: ${String(error)}`));
    return this.writing;
  }
}
