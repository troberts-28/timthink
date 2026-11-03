export interface TaskProgress {
  done: number;
  total: number;
}

export interface DocSummary {
  path: string;
  repo: string;
  project: string | null;
  relPath: string;
  title: string;
  date: string;
  mtime: number;
  status: string | null;
  branch: string | null;
  pr: string | null;
  linear: string | null;
  tasks: TaskProgress;
  frontmatterError: string | null;
}

export type ArchiveState = "active" | "auto" | "manual";

export interface DocArchive {
  state: ArchiveState;
  reason?: string;
}

export interface IndexedDoc extends DocSummary {
  archive: DocArchive;
}

export interface AttachmentSummary {
  path: string;
  relPath: string;
  size: number;
  type: string;
  mtime: number;
}

export interface ProjectIndex {
  name: string;
  docs: IndexedDoc[];
  attachmentCount: number;
}

export interface GithubRepo {
  owner: string;
  repo: string;
}

export type PrLinkHost = "graphite" | "github";

export interface RepoIndex {
  name: string;
  github: GithubRepo | null;
  prLinks: PrLinkHost;
  group: string | null;
  lastActivity: number;
  docCount: number;
  activeCount: number;
  archivedCount: number;
  projects: ProjectIndex[];
  ungrouped: IndexedDoc[];
  rootAttachmentCount: number;
}

export interface DocsIndex {
  generatedAt: string;
  groups: string[] | null;
  repos: RepoIndex[];
}

export interface DocDetail {
  summary: DocSummary;
  raw: string;
  hash: string;
  frontmatter: Record<string, unknown>;
  attachments: AttachmentSummary[];
}
