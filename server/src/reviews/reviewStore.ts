import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isIgnoredName } from "../docs/store.js";
import { ReadOnlyError } from "../readOnly.js";
import { isInside } from "../safePath.js";
import { writeFileAtomic } from "./atomicWrite.js";
import { withFileLock } from "./fileLock.js";
import { docPathForReviewFile, REVIEWS_DIR, reviewFileFor } from "./paths.js";
import { emptyReviewFile, type ReviewFile, reviewFileSchema } from "./schema.js";

export class ReviewConflictError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`The review changed since it was loaded (version ${expected}, now ${actual})`);
    this.name = "ReviewConflictError";
  }
}

export class InvalidDocPathError extends Error {}

export class CorruptReviewFileError extends Error {}

const SAFE_SEGMENT = /^(?!\.\.?$)[^\0]+$/;

export function assertDocPath(docPath: string): void {
  const segments = docPath.split("/");
  if (segments.length < 2 || !segments.every((segment) => SAFE_SEGMENT.test(segment))) {
    throw new InvalidDocPathError(`Invalid doc path: ${docPath}`);
  }
  if (!docPath.toLowerCase().endsWith(".md")) throw new InvalidDocPathError(`Not a markdown doc: ${docPath}`);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export type ReviewMutation = (file: ReviewFile) => ReviewFile | Promise<ReviewFile>;

export interface ReviewStoreOptions {
  readOnly?: boolean;
}

export class ReviewStore {
  constructor(
    readonly docsRoot: string,
    private readonly options: ReviewStoreOptions = {},
  ) {}

  filePath(docPath: string): string {
    assertDocPath(docPath);
    const relative = reviewFileFor(docPath);
    const absolute = relative ? path.resolve(this.docsRoot, relative) : null;
    if (!absolute || !isInside(path.resolve(this.docsRoot), absolute)) {
      throw new InvalidDocPathError(`Invalid doc path: ${docPath}`);
    }
    return absolute;
  }

  async read(docPath: string): Promise<ReviewFile> {
    const filePath = this.filePath(docPath);
    let text: string;
    try {
      text = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissing(error)) return emptyReviewFile(docPath);
      throw error;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new CorruptReviewFileError(`${filePath} isn't valid JSON`);
    }
    const parsed = reviewFileSchema.safeParse(json);
    if (!parsed.success) throw new CorruptReviewFileError(`${filePath} doesn't match the review schema`);
    return parsed.data;
  }

  async update(docPath: string, expectedVersion: number | null, mutate: ReviewMutation): Promise<ReviewFile> {
    if (this.options.readOnly) throw new ReadOnlyError();
    const filePath = this.filePath(docPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    return withFileLock(`${filePath}.lock`, async () => {
      const current = await this.read(docPath);
      if (expectedVersion !== null && expectedVersion !== current.version) {
        throw new ReviewConflictError(expectedVersion, current.version);
      }
      const mutated = await mutate(current);
      if (mutated === current) return current;
      const next = reviewFileSchema.parse({ ...mutated, doc: docPath, version: current.version + 1 });
      await writeFileAtomic(filePath, `${JSON.stringify(next, null, 2)}\n`);
      return next;
    });
  }

  async docsWithReviews(): Promise<string[]> {
    const repos = await readdir(this.docsRoot, { withFileTypes: true }).catch(() => []);
    const found: string[] = [];
    for (const repo of repos) {
      if (!repo.isDirectory() || isIgnoredName(repo.name)) continue;
      const dir = path.join(this.docsRoot, repo.name, REVIEWS_DIR);
      for (const name of await readdir(dir).catch(() => [])) {
        const docPath = docPathForReviewFile(`${repo.name}/${REVIEWS_DIR}/${name}`);
        if (docPath) found.push(docPath);
      }
    }
    return found.sort();
  }
}
