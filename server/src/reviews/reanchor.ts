import { locateAnchor, refreshAnchor } from "./anchor.js";
import type { ReviewFile, Thread } from "./schema.js";

function reanchorThread(thread: Thread, raw: string, hash: string): Thread {
  const match = locateAnchor(raw, thread.anchor);
  if (!match) {
    const status = thread.status === "resolved" ? "resolved" : "outdated";
    return { ...thread, status, anchor: { ...thread.anchor, docHash: hash } };
  }
  const status = thread.status === "outdated" ? "open" : thread.status;
  return { ...thread, status, anchor: refreshAnchor(raw, match, hash) };
}

export function needsReanchor(file: ReviewFile, hash: string): boolean {
  return file.threads.some((thread) => thread.anchor.docHash !== hash);
}

export function reanchorThreads(file: ReviewFile, raw: string, hash: string): ReviewFile {
  if (!needsReanchor(file, hash)) return file;
  return {
    ...file,
    threads: file.threads.map((thread) =>
      thread.anchor.docHash === hash ? thread : reanchorThread(thread, raw, hash),
    ),
  };
}
