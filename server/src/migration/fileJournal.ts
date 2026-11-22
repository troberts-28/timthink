import { appendFile, mkdir, readFile, rename, rmdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../reviews/atomicWrite.js";

const journalEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rename"), from: z.string(), to: z.string() }),
  z.object({ kind: z.literal("write"), path: z.string(), before: z.string().nullable() }),
  z.object({ kind: z.literal("mkdir"), path: z.string() }),
]);

type JournalEntry = z.infer<typeof journalEntrySchema>;

export class FileJournal {
  constructor(readonly filePath: string) {}

  async exists() {
    return (await stat(this.filePath).catch(() => null)) !== null;
  }

  async rename(from: string, to: string) {
    await this.ensureDir(path.dirname(to));
    await this.append({ kind: "rename", from, to });
    await rename(from, to);
  }

  async write(filePath: string, contents: string) {
    await this.recordWrite(filePath);
    await writeFileAtomic(filePath, contents);
  }

  async recordWrite(filePath: string) {
    await this.ensureDir(path.dirname(filePath));
    const before = await readFile(filePath, "utf8").catch(() => null);
    await this.append({ kind: "write", path: filePath, before });
  }

  async undo() {
    const text = await readFile(this.filePath, "utf8");
    const entries = text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => journalEntrySchema.parse(JSON.parse(line)));
    for (const entry of entries.reverse()) {
      await reverse(entry);
    }
    await unlink(this.filePath);
  }

  private async ensureDir(directory: string) {
    const missing: string[] = [];
    for (let current = directory; !(await isDirectory(current)); current = path.dirname(current)) {
      missing.unshift(current);
    }
    for (const created of missing) {
      await this.append({ kind: "mkdir", path: created });
      await mkdir(created);
    }
  }

  private async append(entry: JournalEntry) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`);
  }
}

async function reverse(entry: JournalEntry) {
  if (entry.kind === "mkdir") {
    await rmdir(entry.path).catch(() => {});
    return;
  }
  if (entry.kind === "write") {
    if (entry.before === null) {
      await unlink(entry.path).catch(() => {});
    } else {
      await writeFileAtomic(entry.path, entry.before);
    }
    return;
  }
  const isMoved = (await stat(entry.to).catch(() => null)) !== null;
  const isFromFree = (await stat(entry.from).catch(() => null)) === null;
  if (isMoved && isFromFree) {
    await rename(entry.to, entry.from);
  }
}

async function isDirectory(directory: string) {
  return (await stat(directory).catch(() => null))?.isDirectory() ?? false;
}
