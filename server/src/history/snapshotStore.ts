import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { locateDoc } from "../docs/summarize.js";
import { writeFileAtomic } from "../reviews/atomicWrite.js";
import { docHash, reviewSlug } from "../reviews/paths.js";
import { InvalidDocPathError } from "../reviews/reviewStore.js";
import { isInside } from "../safePath.js";

export const HISTORY_DIR = ".timthink/history";
export const DEFAULT_SNAPSHOT_CAP = 50;
export const SHORT_HASH_LENGTH = 8;

const SNAPSHOT_NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-([0-9a-f]{8})\.md$/;
const SNAPSHOT_SUFFIX = ".md";
const SIDECAR_SUFFIX = ".json";

export const humanWriteSchema = z.object({ by: z.literal("human"), name: z.string() });
export type HumanWrite = z.infer<typeof humanWriteSchema>;

export interface SnapshotEntry {
  id: string;
  at: string;
  shortHash: string;
}

export function shortHash(hash: string): string {
  return hash.slice(0, SHORT_HASH_LENGTH);
}

export function historyDirFor(docPath: string): string | null {
  const location = locateDoc(docPath);
  if (!location) return null;
  return `${location.repo}/${HISTORY_DIR}/${reviewSlug(location.relPath)}`;
}

export function snapshotId(at: Date, hash: string): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${shortHash(hash)}`;
}

export function parseSnapshotName(fileName: string): SnapshotEntry | null {
  const match = SNAPSHOT_NAME.exec(fileName);
  if (!match) return null;
  const [, day, hours, minutes, seconds, millis, hash = ""] = match;
  return {
    id: fileName.slice(0, -SNAPSHOT_SUFFIX.length),
    at: `${day}T${hours}:${minutes}:${seconds}.${millis}Z`,
    shortHash: hash,
  };
}

function oldestFirst(a: SnapshotEntry, b: SnapshotEntry): number {
  return a.at.localeCompare(b.at) || a.id.localeCompare(b.id);
}

export interface SaveOptions {
  at: Date;
  humanWrite?: HumanWrite | null;
  keepHashes?: ReadonlySet<string>;
}

export class SnapshotStore {
  constructor(
    readonly docsRoot: string,
    readonly cap: number = DEFAULT_SNAPSHOT_CAP,
  ) {}

  private dirFor(docPath: string): string {
    const relative = historyDirFor(docPath);
    const absolute = relative ? path.resolve(this.docsRoot, relative) : null;
    if (!absolute || !isInside(path.resolve(this.docsRoot), absolute)) {
      throw new InvalidDocPathError(`Invalid doc path: ${docPath}`);
    }
    return absolute;
  }

  async list(docPath: string): Promise<SnapshotEntry[]> {
    const names = await readdir(this.dirFor(docPath)).catch(() => []);
    return names
      .map(parseSnapshotName)
      .filter((entry) => entry !== null)
      .sort(oldestFirst);
  }

  async latest(docPath: string): Promise<SnapshotEntry | null> {
    return (await this.list(docPath)).at(-1) ?? null;
  }

  async read(docPath: string, id: string): Promise<string | null> {
    if (!parseSnapshotName(`${id}${SNAPSHOT_SUFFIX}`)) return null;
    return readFile(path.join(this.dirFor(docPath), `${id}${SNAPSHOT_SUFFIX}`), "utf8").catch(() => null);
  }

  async humanWrite(docPath: string, id: string): Promise<HumanWrite | null> {
    const text = await readFile(path.join(this.dirFor(docPath), `${id}${SIDECAR_SUFFIX}`), "utf8").catch(() => null);
    if (text === null) return null;
    try {
      const parsed = humanWriteSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async save(docPath: string, raw: string, options: SaveOptions): Promise<SnapshotEntry | null> {
    const hash = docHash(raw);
    const existing = await this.list(docPath);
    if (existing.at(-1)?.shortHash === shortHash(hash)) return null;
    const dir = this.dirFor(docPath);
    await mkdir(dir, { recursive: true });
    const id = uniqueId(snapshotId(laterThan(options.at, existing.at(-1)), hash), existing);
    if (options.humanWrite) {
      await writeFileAtomic(path.join(dir, `${id}${SIDECAR_SUFFIX}`), `${JSON.stringify(options.humanWrite)}\n`);
    }
    await writeFileAtomic(path.join(dir, `${id}${SNAPSHOT_SUFFIX}`), raw);
    const entry = parseSnapshotName(`${id}${SNAPSHOT_SUFFIX}`);
    await this.prune(docPath, [...existing, ...(entry ? [entry] : [])], options.keepHashes ?? new Set());
    return entry;
  }

  private async prune(docPath: string, entries: SnapshotEntry[], keepHashes: ReadonlySet<string>): Promise<void> {
    const sorted = [...entries].sort(oldestFirst);
    const excess = sorted.slice(0, Math.max(0, sorted.length - this.cap));
    const keepShort = new Set([...keepHashes].map(shortHash));
    const dir = this.dirFor(docPath);
    for (const entry of excess) {
      if (keepShort.has(entry.shortHash)) continue;
      await unlink(path.join(dir, `${entry.id}${SNAPSHOT_SUFFIX}`)).catch(() => {});
      await unlink(path.join(dir, `${entry.id}${SIDECAR_SUFFIX}`)).catch(() => {});
    }
  }
}

function laterThan(at: Date, latest: SnapshotEntry | undefined): Date {
  const floor = latest ? Date.parse(latest.at) + 1 : Number.NEGATIVE_INFINITY;
  return at.getTime() >= floor ? at : new Date(floor);
}

function uniqueId(candidate: string, existing: readonly SnapshotEntry[]): string {
  if (!existing.some((entry) => entry.id === candidate)) return candidate;
  const at = parseSnapshotName(`${candidate}${SNAPSHOT_SUFFIX}`);
  if (!at) return candidate;
  const bumped = new Date(Date.parse(at.at) + 1);
  return uniqueId(`${bumped.toISOString().replace(/[:.]/g, "-")}-${at.shortHash}`, existing);
}
