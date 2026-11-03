export type PrState = "draft" | "open" | "queued" | "merged" | "closed";
export type CiState = "passing" | "failing" | "pending";
export type ReviewDecision = "approved" | "changes_requested" | "review_required";

export interface PrInfo {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  state: PrState;
  ci: CiState | null;
  failingChecks: string[];
  review: ReviewDecision | null;
  unresolvedThreads: number;
  headRef: string;
  baseRef: string;
  closedAt: string | null;
  mergedAt: string | null;
  updatedAt: string;
}

export type PrSource = "frontmatter" | "session";

export interface LinkedPr {
  number: number;
  sources: PrSource[];
  info: PrInfo | null;
}

export interface StackItem {
  number: number;
  linked: boolean;
  info: PrInfo | null;
}

export type DocPrsStatus = "ok" | "no-github" | "unavailable" | "disabled";

export interface DocPrsResponse {
  status: DocPrsStatus;
  message: string | null;
  github: { owner: string; repo: string } | null;
  trunk: string | null;
  asOf: string | null;
  refreshing: boolean;
  linked: LinkedPr[];
  unlinked: number[];
  stack: StackItem[];
}

export interface PrLookupResponse {
  status: DocPrsStatus;
  prs: PrInfo[];
}

export function prKey(owner: string, repo: string, number: number): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
}

export function isTerminal(info: PrInfo): boolean {
  return info.state === "merged" || info.state === "closed";
}

export type PrSignalReason = "ci-failing" | "changes-requested" | "review-comments" | "pr-closed-unmerged";

export interface PrSignal {
  reason: PrSignalReason;
  numbers: number[];
  detail: string;
  at: string;
}

export interface PlanCompletion {
  marker: string;
  at: string;
}
