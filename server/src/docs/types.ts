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

export interface AttachmentSummary {
  path: string;
  relPath: string;
  size: number;
  type: string;
  mtime: number;
}

export interface ProjectIndex {
  name: string;
  docs: DocSummary[];
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
  docCount: number;
  projects: ProjectIndex[];
  ungrouped: DocSummary[];
  rootAttachmentCount: number;
}

export interface DocsIndex {
  generatedAt: string;
  repos: RepoIndex[];
}

export interface DocDetail {
  summary: DocSummary;
  raw: string;
  hash: string;
  frontmatter: Record<string, unknown>;
  attachments: AttachmentSummary[];
}
