import type { TimthinkConfig } from "../config.js";
import { DocsStore } from "../docs/store.js";
import { ProjectRegistry } from "../projects/registry.js";
import { ArchiveService } from "./archiveService.js";
import { ArchiveStore } from "./archiveStore.js";

export interface OfflineArchive {
  docs: DocsStore;
  archive: ArchiveService;
}

export type OfflineArchiveConfig = Pick<TimthinkConfig, "docsRoot" | "readOnly">;

export async function openArchive(config: OfflineArchiveConfig): Promise<OfflineArchive> {
  const projects = new ProjectRegistry(config.docsRoot);
  await projects.scan();
  const docs = new DocsStore(config.docsRoot, projects);
  await docs.scanAll();
  const archive = new ArchiveService({
    docs,
    archives: new ArchiveStore(config.docsRoot, { readOnly: config.readOnly }),
    projectStatusOf: (doc) => (doc.projectId ? (projects.project(doc.projectId)?.manifest.status ?? null) : null),
  });
  await archive.init();
  return { docs, archive };
}
