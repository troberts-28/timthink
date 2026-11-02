import { createHash } from "node:crypto";
import { locateDoc } from "../docs/summarize.js";

export const REVIEWS_DIR = ".timthink/reviews";
const REVIEW_FILE_SUFFIX = ".json";
const DOC_HASH_LENGTH = 16;

export function docHash(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, DOC_HASH_LENGTH);
}

export function reviewSlug(repoRelativePath: string): string {
  return encodeURIComponent(repoRelativePath);
}

export function reviewFileFor(docPath: string): string | null {
  const location = locateDoc(docPath);
  if (!location) return null;
  return `${location.repo}/${REVIEWS_DIR}/${reviewSlug(location.relPath)}${REVIEW_FILE_SUFFIX}`;
}

export function docPathForReviewFile(relPath: string): string | null {
  const [repo, ...rest] = relPath.split("/");
  const fileName = rest.pop();
  if (!repo || !fileName || rest.join("/") !== REVIEWS_DIR || !fileName.endsWith(REVIEW_FILE_SUFFIX)) return null;
  try {
    const repoRelative = decodeURIComponent(fileName.slice(0, -REVIEW_FILE_SUFFIX.length));
    return repoRelative.toLowerCase().endsWith(".md") ? `${repo}/${repoRelative}` : null;
  } catch {
    return null;
  }
}
