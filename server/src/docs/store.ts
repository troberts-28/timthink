import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { mimeTypeFor } from "../mime.js";
import { toPosix } from "../safePath.js";
import { analyzeContent, type DocContent } from "./content.js";
import { locateDoc, summarizeDoc } from "./summarize.js";
import type {
  AttachmentSummary,
  DocArchive,
  DocSummary,
  DocsIndex,
  GithubRepo,
  IndexedDoc,
  PrLinkHost,
  ProjectIndex,
  RepoIndex,
} from "./types.js";

export interface RepoInfo {
  github: GithubRepo | null;
  prLinks: PrLinkHost;
  group: string | null;
}

export interface IndexOptions {
  repoInfo: (repo: string) => RepoInfo;
  archiveOf: (doc: DocSummary) => DocArchive;
  groupOrder: (assigned: Array<string | null>) => string[] | null;
}

const IGNORED_NAMES = new Set(["node_modules", "__pycache__"]);
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

export function isIgnoredName(name: string): boolean {
  return name.startsWith(".") || IGNORED_NAMES.has(name);
}

export function isIgnoredPath(relPath: string): boolean {
  return relPath.split("/").some(isIgnoredName);
}

function isMarkdown(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".md");
}

interface AttachmentEntry extends AttachmentSummary {
  repo: string;
  folderProject: string | null;
}

export interface ChangeResult {
  changedDocs: string[];
  removedDocs: string[];
  changed: boolean;
}

function newestFirst(a: DocSummary, b: DocSummary): number {
  return b.date.localeCompare(a.date) || b.mtime - a.mtime;
}

function latestActivity(project: ProjectIndex): string {
  return project.docs[0]?.date ?? "";
}

export class DocsStore {
  private readonly docs = new Map<string, DocSummary>();
  private readonly contents = new Map<string, DocContent>();
  private readonly attachments = new Map<string, AttachmentEntry>();

  constructor(readonly docsRoot: string) {}

  async scanAll(): Promise<void> {
    this.docs.clear();
    this.contents.clear();
    this.attachments.clear();
    const repos = await this.readDirSafe(this.docsRoot);
    await Promise.all(
      repos
        .filter((entry) => entry.isDirectory() && !isIgnoredName(entry.name))
        .map((entry) => this.scanDir(entry.name)),
    );
  }

  getDoc(docPath: string): DocSummary | undefined {
    return this.docs.get(docPath);
  }

  contentOf(docPath: string): DocContent | undefined {
    return this.contents.get(docPath);
  }

  allDocs(): DocSummary[] {
    return [...this.docs.values()];
  }

  hasAttachment(attachmentPath: string): boolean {
    return this.attachments.has(attachmentPath);
  }

  async applyChanges(relPaths: Iterable<string>): Promise<ChangeResult> {
    const result: ChangeResult = { changedDocs: [], removedDocs: [], changed: false };
    for (const relPath of new Set(relPaths)) {
      if (!isIgnoredPath(relPath)) await this.applyChange(relPath, result);
    }
    result.changed = result.changed || result.changedDocs.length > 0 || result.removedDocs.length > 0;
    return result;
  }

  attachmentsFor(doc: DocSummary): AttachmentSummary[] {
    const location = locateDoc(doc.path);
    if (!location) return [];
    const siblings = [...this.attachments.values()].filter(
      (entry) => entry.repo === doc.repo && entry.folderProject === location.folderProject,
    );
    if (location.folderProject !== null) return siblings.map(toAttachmentSummary);
    const datePrefix = DATE_PREFIX.exec(path.posix.basename(doc.relPath))?.[0];
    if (!datePrefix) return [];
    return siblings
      .filter((entry) => path.posix.basename(entry.relPath).startsWith(datePrefix))
      .map(toAttachmentSummary);
  }

  attachmentsIn(repo: string, project: string | null): AttachmentSummary[] {
    return [...this.attachments.values()]
      .filter((entry) => entry.repo === repo && entry.folderProject === project)
      .sort((a, b) => a.relPath.localeCompare(b.relPath))
      .map(toAttachmentSummary);
  }

  repoNames(): string[] {
    const names = new Set<string>();
    for (const doc of this.docs.values()) names.add(doc.repo);
    for (const attachment of this.attachments.values()) names.add(attachment.repo);
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  buildIndex(options: IndexOptions): DocsIndex {
    const repos = this.repoNames()
      .map((name) => this.buildRepoIndex(name, options.repoInfo(name), options.archiveOf))
      .sort((a, b) => b.lastActivity - a.lastActivity || a.name.localeCompare(b.name));
    return {
      generatedAt: new Date().toISOString(),
      groups: options.groupOrder(repos.map((repo) => repo.group)),
      repos,
    };
  }

  private buildRepoIndex(
    name: string,
    { github, prLinks, group }: RepoInfo,
    archiveOf: (doc: DocSummary) => DocArchive,
  ): RepoIndex {
    const repoDocs: IndexedDoc[] = [...this.docs.values()]
      .filter((doc) => doc.repo === name)
      .sort(newestFirst)
      .map((doc) => ({ ...doc, archive: archiveOf(doc) }));
    const repoAttachments = [...this.attachments.values()].filter((entry) => entry.repo === name);
    const projects = new Map<string, ProjectIndex>();
    const projectFor = (projectName: string): ProjectIndex => {
      let project = projects.get(projectName);
      if (!project) {
        project = { name: projectName, docs: [], attachmentCount: 0 };
        projects.set(projectName, project);
      }
      return project;
    };
    const ungrouped: IndexedDoc[] = [];
    for (const doc of repoDocs) {
      if (doc.project === null) ungrouped.push(doc);
      else projectFor(doc.project).docs.push(doc);
    }
    let rootAttachmentCount = 0;
    for (const entry of repoAttachments) {
      if (entry.folderProject === null) rootAttachmentCount += 1;
      else projectFor(entry.folderProject).attachmentCount += 1;
    }
    const sortedProjects = [...projects.values()].sort(
      (a, b) => latestActivity(b).localeCompare(latestActivity(a)) || a.name.localeCompare(b.name),
    );
    const archivedCount = repoDocs.filter((doc) => doc.archive.state !== "active").length;
    const lastActivity = Math.max(0, ...repoDocs.map((doc) => doc.mtime), ...repoAttachments.map((file) => file.mtime));
    return {
      name,
      github,
      prLinks,
      group,
      lastActivity,
      docCount: repoDocs.length,
      activeCount: repoDocs.length - archivedCount,
      archivedCount,
      projects: sortedProjects,
      ungrouped,
      rootAttachmentCount,
    };
  }

  private async applyChange(relPath: string, result: ChangeResult): Promise<void> {
    const absolute = path.join(this.docsRoot, relPath);
    const stats = await stat(absolute).catch(() => null);
    if (!stats) {
      this.removeUnder(relPath, result);
      return;
    }
    if (stats.isDirectory()) {
      const before = new Set(this.keysUnder(relPath));
      const touched = await this.scanDir(relPath, result);
      for (const key of before) {
        if (!touched.has(key)) this.removeKey(key, result);
      }
      result.changed = true;
      return;
    }
    if (stats.isFile()) await this.upsertFile(relPath, stats.size, stats.mtimeMs, result);
  }

  private async scanDir(relDir: string, result?: ChangeResult): Promise<Set<string>> {
    const touched = new Set<string>();
    const entries = await this.readDirSafe(path.join(this.docsRoot, relDir));
    await Promise.all(
      entries.map(async (entry) => {
        if (isIgnoredName(entry.name) || entry.isSymbolicLink()) return;
        const relPath = `${relDir}/${entry.name}`;
        if (entry.isDirectory()) {
          for (const key of await this.scanDir(relPath, result)) touched.add(key);
          return;
        }
        if (!entry.isFile()) return;
        const stats = await stat(path.join(this.docsRoot, relPath)).catch(() => null);
        if (!stats) return;
        await this.upsertFile(relPath, stats.size, stats.mtimeMs, result);
        touched.add(relPath);
      }),
    );
    return touched;
  }

  private async upsertFile(relPath: string, size: number, mtime: number, result?: ChangeResult): Promise<void> {
    const location = locateDoc(relPath);
    if (!location) return;
    if (isMarkdown(relPath)) {
      const raw = await readFile(path.join(this.docsRoot, relPath), "utf8").catch(() => null);
      if (raw === null) return;
      const summary = summarizeDoc({ path: relPath, raw, mtime });
      if (!summary) return;
      this.docs.set(relPath, summary);
      this.contents.set(relPath, analyzeContent(raw));
      result?.changedDocs.push(relPath);
      return;
    }
    this.attachments.set(relPath, {
      path: relPath,
      repo: location.repo,
      relPath: location.relPath,
      folderProject: location.folderProject,
      size,
      type: mimeTypeFor(relPath),
      mtime,
    });
    if (result) result.changed = true;
  }

  private keysUnder(relPath: string): string[] {
    const prefix = `${relPath}/`;
    return [...this.docs.keys(), ...this.attachments.keys()].filter((key) => key === relPath || key.startsWith(prefix));
  }

  private removeUnder(relPath: string, result: ChangeResult): void {
    for (const key of this.keysUnder(relPath)) this.removeKey(key, result);
  }

  private removeKey(key: string, result: ChangeResult): void {
    this.contents.delete(key);
    if (this.docs.delete(key)) result.removedDocs.push(key);
    if (this.attachments.delete(key)) result.changed = true;
  }

  private async readDirSafe(absolute: string): Promise<Dirent[]> {
    return readdir(absolute, { withFileTypes: true }).catch(() => []);
  }
}

function toAttachmentSummary(entry: AttachmentEntry): AttachmentSummary {
  return { path: entry.path, relPath: entry.relPath, size: entry.size, type: entry.type, mtime: entry.mtime };
}

export function relativeToRoot(root: string, absolute: string): string {
  return toPosix(path.relative(root, absolute));
}
