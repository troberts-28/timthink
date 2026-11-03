import type { TimthinkConfig } from "../config.js";
import { DocsStore } from "../docs/store.js";
import { ReviewStore } from "../reviews/reviewStore.js";
import { readSeenFile, type SeenFile } from "../seen/seenStore.js";
import { ArchiveService, type ReadMarks } from "./archiveService.js";
import { ArchiveStore } from "./archiveStore.js";

export interface OfflineArchive {
  docs: DocsStore;
  archive: ArchiveService;
}

function marksFrom(seen: SeenFile | null): ReadMarks {
  return {
    docSeenAt: (docPath) => seen?.docs[docPath]?.at ?? null,
    threadReadAt: (docPath, threadId) => seen?.threads[`${docPath}#${threadId}`] ?? null,
  };
}

export type OfflineArchiveConfig = Pick<TimthinkConfig, "docsRoot" | "stateDir" | "archive" | "readOnly">;

export async function openArchive(config: OfflineArchiveConfig): Promise<OfflineArchive> {
  const docs = new DocsStore(config.docsRoot);
  const [, seen] = await Promise.all([docs.scanAll(), readSeenFile(config.stateDir)]);
  const archive = new ArchiveService({
    docs,
    reviews: new ReviewStore(config.docsRoot, { readOnly: config.readOnly }),
    archives: new ArchiveStore(config.docsRoot, { readOnly: config.readOnly }),
    marks: marksFrom(seen),
    settings: config.archive,
  });
  await archive.init();
  return { docs, archive };
}
