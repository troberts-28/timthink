export interface TaskProgress {
  done: number;
  total: number;
}

export const DOC_KINDS = ["plan", "research", "design", "handoff", "decision", "notes"] as const;

export type DocKind = (typeof DOC_KINDS)[number];

export interface DocSummary {
  path: string;
  repo: string;
  project: string | null;
  projectId: string | null;
  codeRepo: string;
  repoOverride: string | null;
  kind: DocKind;
  relPath: string;
  title: string;
  date: string;
  mtime: number;
  status: string | null;
  branch: string | null;
  prs: string[];
  linear: string | null;
  tasks: TaskProgress;
  frontmatterError: string | null;
}

export type ArchiveState = "active" | "auto" | "manual";

export interface DocArchive {
  state: ArchiveState;
  reason?: string;
}

export type PrAttention = "ci-failing" | "changes-requested";

export interface IndexedDoc extends DocSummary {
  archive: DocArchive;
  prAttention: PrAttention | null;
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
  hidden: boolean;
  buildLauncher: boolean;
  lastActivity: number;
  docCount: number;
  activeCount: number;
  archivedCount: number;
  projects: ProjectIndex[];
  ungrouped: IndexedDoc[];
  rootAttachmentCount: number;
}

export type ProjectStatus = "active" | "paused" | "shipped" | "dropped";

export interface ProjectEntry {
  id: string;
  area: string | null;
  slug: string;
  title: string;
  summary: string | null;
  status: ProjectStatus;
  repos: string[];
  problems: string[];
  docs: IndexedDoc[];
  attachmentCount: number;
  lastActivity: number;
}

export interface AreaEntry {
  id: string;
  title: string;
  summary: string | null;
  repos: string[];
  problems: string[];
  projects: ProjectEntry[];
  docs: IndexedDoc[];
  lastActivity: number;
}

export interface CodeRepoInfo {
  github: GithubRepo | null;
  prLinks: PrLinkHost;
  buildLauncher: boolean;
}

export interface DocsIndex {
  generatedAt: string;
  groups: string[] | null;
  sidebarQuotes: string[];
  areas: AreaEntry[];
  projects: ProjectEntry[];
  codeRepos: Record<string, CodeRepoInfo>;
  repos: RepoIndex[];
}

export interface PhaseSummary {
  number: number;
  title: string;
  tasks: TaskProgress;
}

export interface DocDetail {
  summary: DocSummary;
  phases: PhaseSummary[];
  raw: string;
  hash: string;
  frontmatter: Record<string, unknown>;
  attachments: AttachmentSummary[];
}
