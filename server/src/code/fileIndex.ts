import { listTrackedFiles, readHead } from "./git.js";

interface FileIndexEntry {
  head: string;
  files: string[];
  byBasename: Map<string, string[]>;
}

export interface FileIndex {
  head: string;
  files: readonly string[];
  byBasename: ReadonlyMap<string, readonly string[]>;
}

function basenameOf(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  return slash === -1 ? filePath : filePath.slice(slash + 1);
}

function indexByBasename(files: readonly string[]): Map<string, string[]> {
  const byBasename = new Map<string, string[]>();
  for (const file of files) {
    const name = basenameOf(file);
    const bucket = byBasename.get(name);
    if (bucket) bucket.push(file);
    else byBasename.set(name, [file]);
  }
  return byBasename;
}

export class GitFileIndexCache {
  private readonly entries = new Map<string, FileIndexEntry>();
  private readonly inflight = new Map<string, Promise<FileIndex | null>>();

  async get(checkout: string): Promise<FileIndex | null> {
    const existing = this.inflight.get(checkout);
    if (existing) return existing;
    const pending = this.load(checkout).finally(() => this.inflight.delete(checkout));
    this.inflight.set(checkout, pending);
    return pending;
  }

  private async load(checkout: string): Promise<FileIndex | null> {
    const head = await readHead(checkout);
    if (!head) return null;
    const cached = this.entries.get(checkout);
    if (cached?.head === head) return cached;
    const files = await listTrackedFiles(checkout);
    const entry: FileIndexEntry = { head, files, byBasename: indexByBasename(files) };
    this.entries.set(checkout, entry);
    return entry;
  }
}
