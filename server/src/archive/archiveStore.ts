import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isIgnoredName } from "../docs/store.js";
import { locateDoc } from "../docs/summarize.js";
import { ReadOnlyError } from "../readOnly.js";
import { writeFileAtomic } from "../reviews/atomicWrite.js";
import { withFileLock } from "../reviews/fileLock.js";
import { assertDocPath, InvalidDocPathError } from "../reviews/reviewStore.js";
import { isInside } from "../safePath.js";
import type { ManualArchive } from "./archiveRule.js";

export const ARCHIVE_FILE = ".timthink/archive.json";
export const ARCHIVE_SCHEMA_VERSION = 1;

export const ARCHIVE_ACTIONS = ["archive", "keep-active", "clear"] as const;
export type ArchiveAction = (typeof ARCHIVE_ACTIONS)[number];

const archiveFileSchema = z.object({
  schemaVersion: z.literal(ARCHIVE_SCHEMA_VERSION),
  version: z.number().int().nonnegative(),
  archived: z.record(z.string(), z.string()),
  keepActive: z.record(z.string(), z.string()),
});

export type ArchiveFile = z.infer<typeof archiveFileSchema>;

export class CorruptArchiveFileError extends Error {}

export function emptyArchiveFile(): ArchiveFile {
  return { schemaVersion: ARCHIVE_SCHEMA_VERSION, version: 0, archived: {}, keepActive: {} };
}

export function repoForArchiveFile(relPath: string): string | null {
  const [repo, ...rest] = relPath.split("/");
  return repo && rest.join("/") === ARCHIVE_FILE ? repo : null;
}

export function manualFor(file: ArchiveFile, repoRelPath: string): ManualArchive {
  const archivedAt = file.archived[repoRelPath];
  if (archivedAt) return { kind: "archived", at: archivedAt };
  const keptAt = file.keepActive[repoRelPath];
  return keptAt ? { kind: "keep-active", at: keptAt } : null;
}

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export function applyArchiveAction(
  file: ArchiveFile,
  repoRelPath: string,
  action: ArchiveAction,
  now: string,
): ArchiveFile {
  const archived = withoutKey(file.archived, repoRelPath);
  const keepActive = withoutKey(file.keepActive, repoRelPath);
  if (action === "archive") archived[repoRelPath] = now;
  if (action === "keep-active") keepActive[repoRelPath] = now;
  return { ...file, archived, keepActive };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export interface ArchiveStoreOptions {
  readOnly?: boolean;
}

export class ArchiveStore {
  constructor(
    readonly docsRoot: string,
    private readonly options: ArchiveStoreOptions = {},
  ) {}

  filePath(repo: string): string {
    if (!repo || isIgnoredName(repo) || repo.includes("/") || repo.includes("\\")) {
      throw new InvalidDocPathError(`Invalid repo: ${repo}`);
    }
    const root = path.resolve(this.docsRoot);
    const absolute = path.resolve(root, repo, ARCHIVE_FILE);
    if (!isInside(root, absolute)) throw new InvalidDocPathError(`Invalid repo: ${repo}`);
    return absolute;
  }

  async read(repo: string): Promise<ArchiveFile> {
    const filePath = this.filePath(repo);
    let text: string;
    try {
      text = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissing(error)) return emptyArchiveFile();
      throw error;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new CorruptArchiveFileError(`${filePath} isn't valid JSON`);
    }
    const parsed = archiveFileSchema.safeParse(json);
    if (!parsed.success) throw new CorruptArchiveFileError(`${filePath} doesn't match the archive schema`);
    return parsed.data;
  }

  async update(repo: string, mutate: (file: ArchiveFile) => ArchiveFile): Promise<ArchiveFile> {
    if (this.options.readOnly) throw new ReadOnlyError();
    const filePath = this.filePath(repo);
    await mkdir(path.dirname(filePath), { recursive: true });
    return withFileLock(`${filePath}.lock`, async () => {
      const current = await this.read(repo);
      const mutated = mutate(current);
      if (mutated === current) return current;
      const next = archiveFileSchema.parse({ ...mutated, version: current.version + 1 });
      await writeFileAtomic(filePath, `${JSON.stringify(next, null, 2)}\n`);
      return next;
    });
  }

  async apply(docPath: string, action: ArchiveAction, now: string): Promise<ArchiveFile> {
    assertDocPath(docPath);
    const location = locateDoc(docPath);
    if (!location) throw new InvalidDocPathError(`Invalid doc path: ${docPath}`);
    return this.update(location.repo, (file) => applyArchiveAction(file, location.relPath, action, now));
  }
}
