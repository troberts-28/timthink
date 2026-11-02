import { type FSWatcher, watch } from "node:fs";
import { toPosix } from "../safePath.js";

export interface DocsWatcher {
  close(): void;
}

export interface WatchOptions {
  debounceMs?: number;
  onError?: (error: Error) => void;
}

export function watchDocsRoot(
  docsRoot: string,
  onChanges: (relPaths: string[]) => void,
  { debounceMs = 150, onError }: WatchOptions = {},
): DocsWatcher {
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  const flush = (): void => {
    timer = null;
    const batch = [...pending];
    pending.clear();
    if (batch.length > 0) onChanges(batch);
  };

  const watcher: FSWatcher = watch(docsRoot, { recursive: true, persistent: false }, (_event, fileName) => {
    if (!fileName) return;
    pending.add(toPosix(fileName.toString()));
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  });
  watcher.on("error", (error) => onError?.(error));

  return {
    close(): void {
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}
