import type { DocsStore } from "../docs/store.js";
import type { DocArchive, DocSummary } from "../docs/types.js";
import { archiveState } from "./archiveRule.js";
import {
  type ArchiveAction,
  type ArchiveFile,
  type ArchiveStore,
  emptyArchiveFile,
  manualFor,
} from "./archiveStore.js";

export interface ArchiveServiceDeps {
  docs: DocsStore;
  archives: ArchiveStore;
  projectStatusOf?: (doc: DocSummary) => string | null;
  now?: () => number;
  log?: (message: string) => void;
}

export class ArchiveService {
  private readonly manual = new Map<string, ArchiveFile>();
  private readonly now: () => number;

  constructor(private readonly deps: ArchiveServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  async init(): Promise<void> {
    await Promise.all(this.deps.docs.repoNames().map((repo) => this.reloadRepo(repo)));
  }

  stateFor(doc: DocSummary): DocArchive {
    const file = this.manual.get(doc.repo);
    return archiveState({
      manual: file ? manualFor(file, doc.relPath) : null,
      now: this.now(),
      projectStatus: this.deps.projectStatusOf?.(doc) ?? null,
    });
  }

  isArchived(doc: DocSummary): boolean {
    return this.stateFor(doc).state !== "active";
  }

  async ensureRepos(repos: readonly string[]): Promise<boolean> {
    const missing = repos.filter((repo) => !this.manual.has(repo));
    const changed = await Promise.all(missing.map((repo) => this.reloadRepo(repo)));
    return changed.some(Boolean);
  }

  async reloadRepo(repo: string): Promise<boolean> {
    const before = this.manual.get(repo);
    let next: ArchiveFile;
    try {
      next = await this.deps.archives.read(repo);
    } catch (error) {
      this.deps.log?.(`reading the archive for ${repo} failed: ${String(error)}`);
      next = before ?? emptyArchiveFile();
    }
    this.manual.set(repo, next);
    return before?.version !== next.version;
  }

  async apply(docPath: string, action: ArchiveAction): Promise<void> {
    const file = await this.deps.archives.apply(docPath, action, new Date(this.now()).toISOString());
    const repo = docPath.split("/")[0];
    if (repo) this.manual.set(repo, file);
  }
}
