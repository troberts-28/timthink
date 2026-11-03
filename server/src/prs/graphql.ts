import type { CiState, PrInfo, PrState, ReviewDecision } from "./types.js";

export interface MergeCheck {
  number: number;
  closedAt: string;
}

export interface RepoQuery {
  owner: string;
  repo: string;
  numbers: number[];
  parentsOf: string[];
  childrenOf: string[];
  mergeChecks: MergeCheck[];
  trunk: string | null;
}

export interface RawPr {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  merged: boolean;
  mergedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
  isInMergeQueue?: boolean;
  author: { login: string } | null;
  labels: { nodes: { name: string }[] } | null;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  reviewThreads: { nodes: { isResolved: boolean }[] } | null;
  commits: {
    nodes: {
      commit: {
        statusCheckRollup: {
          state: string;
          contexts: { nodes: RawCheck[] };
        } | null;
      };
    }[];
  } | null;
}

type RawCheck =
  | { __typename: "CheckRun"; name: string; conclusion: string | null; status: string }
  | { __typename: "StatusContext"; context: string; state: string };

export interface RepoQueryResult {
  trunk: string | null;
  prs: RawPr[];
  mergeHeadlines: Map<number, string[]>;
}

const MERGE_WINDOW_MS = 60 * 60 * 1000;
const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const FAILED_STATES = new Set(["FAILURE", "ERROR"]);

const PR_FIELDS = `fragment P on PullRequest {
  number title url state isDraft merged mergedAt closedAt updatedAt headRefName baseRefName isInMergeQueue
  author { login }
  labels(first: 20) { nodes { name } }
  reviewDecision
  reviewThreads(first: 100) { nodes { isResolved } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes {
    __typename
    ... on CheckRun { name conclusion status }
    ... on StatusContext { context state }
  } } } } } }
}`;

function literal(value: string): string {
  return JSON.stringify(value);
}

function shiftIso(iso: string, deltaMs: number): string {
  return new Date(Date.parse(iso) + deltaMs).toISOString();
}

export function buildRepoQuery(query: RepoQuery): string {
  const fields: string[] = ["defaultBranchRef { name }"];
  for (const number of query.numbers) fields.push(`p${number}: pullRequest(number: ${number}) { ...P }`);
  query.parentsOf.forEach((ref, index) => {
    fields.push(
      `h${index}: pullRequests(headRefName: ${literal(ref)}, first: 3, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ...P } }`,
    );
  });
  query.childrenOf.forEach((ref, index) => {
    fields.push(`b${index}: pullRequests(baseRefName: ${literal(ref)}, first: 10, states: [OPEN]) { nodes { ...P } }`);
  });
  const trunk = query.trunk ?? "HEAD";
  for (const { number, closedAt } of query.mergeChecks) {
    const since = shiftIso(closedAt, -MERGE_WINDOW_MS);
    const until = shiftIso(closedAt, MERGE_WINDOW_MS);
    fields.push(
      `m${number}: object(expression: ${literal(trunk)}) { ... on Commit { history(first: 100, since: ${literal(since)}, until: ${literal(until)}) { nodes { messageHeadline } } } }`,
    );
  }
  return `query { repository(owner: ${literal(query.owner)}, name: ${literal(query.repo)}) {\n  ${fields.join("\n  ")}\n} }\n${PR_FIELDS}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRawPr(value: unknown): value is RawPr {
  return isRecord(value) && typeof value.number === "number" && typeof value.headRefName === "string";
}

export function parseRepoQuery(response: unknown): RepoQueryResult {
  const repository = isRecord(response) && isRecord(response.data) ? response.data.repository : null;
  const result: RepoQueryResult = { trunk: null, prs: [], mergeHeadlines: new Map() };
  if (!isRecord(repository)) return result;
  const byNumber = new Map<number, RawPr>();
  for (const [alias, value] of Object.entries(repository)) {
    if (alias === "defaultBranchRef") {
      result.trunk = isRecord(value) && typeof value.name === "string" ? value.name : null;
    } else if (/^p\d+$/.test(alias) && isRawPr(value)) {
      byNumber.set(value.number, value);
    } else if (/^[hb]\d+$/.test(alias) && isRecord(value) && Array.isArray(value.nodes)) {
      for (const node of value.nodes) if (isRawPr(node)) byNumber.set(node.number, node);
    } else if (/^m\d+$/.test(alias) && isRecord(value) && isRecord(value.history)) {
      const nodes = Array.isArray(value.history.nodes) ? value.history.nodes : [];
      const headlines = nodes.flatMap((node) =>
        isRecord(node) && typeof node.messageHeadline === "string" ? [node.messageHeadline] : [],
      );
      result.mergeHeadlines.set(Number(alias.slice(1)), headlines);
    }
  }
  result.prs = [...byNumber.values()];
  return result;
}

export function landedOnTrunk(number: number, headlines: readonly string[]): boolean {
  const suffix = `(#${number})`;
  return headlines.some((headline) => headline.trimEnd().endsWith(suffix));
}

function ciState(raw: RawPr): { ci: CiState | null; failingChecks: string[] } {
  const rollup = raw.commits?.nodes[0]?.commit.statusCheckRollup ?? null;
  if (!rollup) return { ci: null, failingChecks: [] };
  const failingChecks = rollup.contexts.nodes.flatMap((check) => {
    if (check.__typename === "CheckRun") {
      return check.conclusion && FAILED_CONCLUSIONS.has(check.conclusion) ? [check.name] : [];
    }
    return FAILED_STATES.has(check.state) ? [check.context] : [];
  });
  if (rollup.state === "SUCCESS") return { ci: "passing", failingChecks };
  if (FAILED_STATES.has(rollup.state)) return { ci: "failing", failingChecks };
  return { ci: "pending", failingChecks };
}

const REVIEW_DECISIONS: Record<NonNullable<RawPr["reviewDecision"]>, ReviewDecision> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  REVIEW_REQUIRED: "review_required",
};

function lifecycle(raw: RawPr, queueLabels: ReadonlySet<string>, landed: boolean): PrState {
  if (raw.merged || raw.state === "MERGED") return "merged";
  if (raw.state === "CLOSED") return landed ? "merged" : "closed";
  if (raw.isDraft) return "draft";
  const queued = raw.isInMergeQueue || (raw.labels?.nodes ?? []).some((label) => queueLabels.has(label.name));
  return queued ? "queued" : "open";
}

export function toPrInfo(
  raw: RawPr,
  owner: string,
  repo: string,
  queueLabels: ReadonlySet<string>,
  landed: boolean,
): PrInfo {
  const state = lifecycle(raw, queueLabels, landed);
  return {
    owner,
    repo,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author: raw.author?.login ?? null,
    state,
    ...ciState(raw),
    review: raw.reviewDecision ? REVIEW_DECISIONS[raw.reviewDecision] : null,
    unresolvedThreads: (raw.reviewThreads?.nodes ?? []).filter((thread) => !thread.isResolved).length,
    headRef: raw.headRefName,
    baseRef: raw.baseRefName,
    closedAt: raw.closedAt,
    mergedAt: raw.mergedAt ?? (state === "merged" ? raw.closedAt : null),
    updatedAt: raw.updatedAt,
  };
}
