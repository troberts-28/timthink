import type { ArchiveSettings } from "../config.js";
import type { DocsStore } from "../docs/store.js";
import type { DocArchive, DocSummary } from "../docs/types.js";
import type { ReviewStore } from "../reviews/reviewStore.js";
import { archiveState } from "./archiveRule.js";
import {
  type ArchiveAction,
  type ArchiveFile,
  type ArchiveStore,
  emptyArchiveFile,
  manualFor,
} from "./archiveStore.js";
import { reviewNeedsUser } from "./needsUser.js";

export interface ReadMarks {
  docSeenAt(docPath: string): string | null;
  threadReadAt(docPath: string, threadId: string): string | null;
}

export interface ArchiveServiceDeps {
  docs: DocsStore;
  reviews: ReviewStore;
  archives: ArchiveStore;
  marks: ReadMarks;
  settings: ArchiveSettings;
  now?: () => number;
  log?: (message: string) => void;
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export class ArchiveService {
  private readonly manual = new Map<string, ArchiveFile>();
  private readonly needingUser = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly deps: ArchiveServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  get settings(): ArchiveSettings {
    return this.deps.settings;
  }

  async init(): Promise<void> {
    await Promise.all(this.deps.docs.repoNames().map((repo) => this.reloadRepo(repo)));
    const reviewed = await this.deps.reviews.docsWithReviews();
    await Promise.all(reviewed.map((docPath) => this.refreshDoc(docPath)));
  }

  stateFor(doc: DocSummary): DocArchive {
    const file = this.manual.get(doc.repo);
    return archiveState({
      status: doc.status,
      mtime: doc.mtime,
      manual: file ? manualFor(file, doc.relPath) : null,
      needsUser: this.needingUser.has(doc.path),
      settings: this.deps.settings,
      now: this.now(),
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

  async refreshDoc(docPath: string): Promise<boolean> {
    const before = this.needingUser.has(docPath);
    const file = await this.deps.reviews.read(docPath).catch(() => null);
    const seenAt = this.deps.marks.docSeenAt(docPath);
    const after =
      file !== null &&
      reviewNeedsUser(file, (threadId) => later(seenAt, this.deps.marks.threadReadAt(docPath, threadId)));
    if (after) this.needingUser.add(docPath);
    else this.needingUser.delete(docPath);
    return before !== after;
  }

  async apply(docPath: string, action: ArchiveAction): Promise<void> {
    const file = await this.deps.archives.apply(docPath, action, new Date(this.now()).toISOString());
    const repo = docPath.split("/")[0];
    if (repo) this.manual.set(repo, file);
  }
}
