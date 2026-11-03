import { describe, expect, it } from "vitest";
import { DEFAULT_PR_SETTINGS } from "../config.js";
import type { DocSummary } from "../docs/types.js";
import type { SessionRecord } from "../sessions/sessionStore.js";
import { makeTempDir } from "../test/fixtures.js";
import type { GraphqlRunner } from "./ghClient.js";
import type { RawPr } from "./graphql.js";
import { PrService } from "./prService.js";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const GITHUB = { owner: "acme", repo: "api" };

function rawPr(overrides: Partial<RawPr> & { number: number }): RawPr {
  return {
    title: `PR ${overrides.number}`,
    url: `https://github.com/acme/api/pull/${overrides.number}`,
    state: "OPEN",
    isDraft: false,
    merged: false,
    mergedAt: null,
    closedAt: null,
    updatedAt: "2026-11-03T10:00:00Z",
    headRefName: `feat/${overrides.number}`,
    baseRefName: "main",
    author: { login: "me" },
    labels: { nodes: [] },
    reviewDecision: null,
    reviewThreads: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS", contexts: { nodes: [] } } } }] },
    ...overrides,
  };
}

function fakeGithub(prs: RawPr[], trunkHeadlines: string[] = []) {
  const queries: string[] = [];
  const runner: GraphqlRunner = async (query) => {
    queries.push(query);
    const repository: Record<string, unknown> = { defaultBranchRef: { name: "main" } };
    for (const [, alias, number] of query.matchAll(/(p(\d+)): pullRequest\(/g)) {
      repository[alias ?? ""] = prs.find((pr) => pr.number === Number(number)) ?? null;
    }
    for (const [, alias, ref] of query.matchAll(/(h\d+): pullRequests\(headRefName: "([^"]+)"/g)) {
      repository[alias ?? ""] = { nodes: prs.filter((pr) => pr.headRefName === ref) };
    }
    for (const [, alias, ref] of query.matchAll(/(b\d+): pullRequests\(baseRefName: "([^"]+)"/g)) {
      repository[alias ?? ""] = { nodes: prs.filter((pr) => pr.baseRefName === ref && pr.state === "OPEN") };
    }
    for (const [, alias] of query.matchAll(/(m\d+): object\(/g)) {
      repository[alias ?? ""] = { history: { nodes: trunkHeadlines.map((message) => ({ message })) } };
    }
    return { data: { repository } };
  };
  return { runner, queries };
}

function doc(overrides: Partial<DocSummary> = {}): DocSummary {
  return {
    path: "api/plan.md",
    repo: "api",
    project: null,
    relPath: "plan.md",
    title: "Plan",
    date: "2026-11-03",
    mtime: NOW,
    status: "in-progress",
    branch: null,
    prs: [],
    linear: null,
    tasks: { done: 0, total: 0 },
    frontmatterError: null,
    ...overrides,
  };
}

function session(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    id: "s1",
    title: "Session",
    cwd: null,
    branch: null,
    firstSeen: null,
    lastActivity: null,
    live: false,
    livenessKnown: false,
    warpFocusUrl: null,
    transcriptPath: null,
    docPaths: [],
    writtenDocPaths: [],
    plannedDocPaths: [],
    builtDocPaths: [],
    submittedPrs: [],
    ...overrides,
  };
}

async function service(docs: DocSummary[], runner: GraphqlRunner, sessions: SessionRecord[] = []) {
  const changes: string[][] = [];
  const prs = new PrService({
    settings: { ...DEFAULT_PR_SETTINGS, mergeQueueLabels: ["merge_queue"] },
    stateDir: await makeTempDir("timthink-prs-"),
    docs: { getDoc: (path) => docs.find((candidate) => candidate.path === path), allDocs: () => docs },
    sessions: { all: () => sessions },
    githubFor: (repo) => (repo === "api" ? GITHUB : null),
    isArchived: () => false,
    runner,
    onChange: (paths) => changes.push(paths),
    hasViewers: () => true,
    now: () => NOW,
  });
  await prs.init();
  return { prs, changes };
}

describe("PrService", () => {
  it("treats a queue-closed PR with its squash commit on the trunk as merged, and others as closed", async () => {
    const github = fakeGithub(
      [
        rawPr({ number: 12, state: "CLOSED", closedAt: "2026-11-02T17:25:36Z" }),
        rawPr({ number: 13, state: "CLOSED", closedAt: "2026-11-02T17:25:36Z" }),
        rawPr({ number: 14, state: "MERGED", merged: true, mergedAt: "2026-11-01T09:00:00Z" }),
      ],
      ["feat: count warnings (#12)", "chore: unrelated (#99)"],
    );
    const { prs } = await service([doc({ prs: ["12", "13", "14"] })], github.runner);
    await prs.refresh();
    const states = Object.fromEntries(prs.docPrs("api/plan.md").linked.map((pr) => [pr.number, pr.info?.state]));
    expect(states).toEqual({ 12: "merged", 13: "closed", 14: "merged" });
    expect(github.queries.some((query) => query.includes('m12: object(expression: "main")'))).toBe(true);
  });

  it("never refetches merged PRs once known", async () => {
    const github = fakeGithub([rawPr({ number: 14, state: "MERGED", merged: true })]);
    const { prs } = await service([doc({ prs: ["14"] })], github.runner);
    await prs.refresh();
    const before = github.queries.length;
    await prs.refresh();
    expect(github.queries.length).toBe(before);
  });

  it("reads lifecycle, CI and review from an open PR", async () => {
    const github = fakeGithub([
      rawPr({
        number: 30,
        labels: { nodes: [{ name: "merge_queue" }] },
        reviewDecision: "CHANGES_REQUESTED",
        reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] },
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  state: "FAILURE",
                  contexts: {
                    nodes: [
                      { __typename: "CheckRun", name: "test", conclusion: "FAILURE", status: "COMPLETED" },
                      { __typename: "CheckRun", name: "lint", conclusion: "SUCCESS", status: "COMPLETED" },
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
    ]);
    const { prs } = await service([doc({ prs: ["30"] })], github.runner);
    await prs.refresh();
    expect(prs.docPrs("api/plan.md").linked[0]?.info).toMatchObject({
      state: "queued",
      ci: "failing",
      failingChecks: ["test"],
      review: "changes_requested",
      unresolvedThreads: 1,
    });
  });

  it("links PRs the plan's sessions submitted in the same repo, and honours unlinking", async () => {
    const github = fakeGithub([rawPr({ number: 40 }), rawPr({ number: 41 })]);
    const sessions = [
      session({
        writtenDocPaths: ["api/plan.md"],
        submittedPrs: [
          { owner: "acme", repo: "api", number: 40, branch: "feat/40", at: null },
          { owner: "acme", repo: "api", number: 41, branch: "feat/41", at: null },
          { owner: "acme", repo: "other", number: 42, branch: null, at: null },
        ],
      }),
    ];
    const { prs } = await service([doc({ prs: ["40"] })], github.runner, sessions);
    await prs.refresh();
    expect(prs.docPrs("api/plan.md").linked.map(({ number, sources }) => ({ number, sources }))).toEqual([
      { number: 40, sources: ["frontmatter", "session"] },
      { number: 41, sources: ["session"] },
    ]);
    await prs.setUnlinked("api/plan.md", 41, true);
    expect(prs.docPrs("api/plan.md").linked.map((pr) => pr.number)).toEqual([40]);
    expect(prs.docPrs("api/plan.md").unlinked).toEqual([41]);
  });

  it("rebuilds the stack around a linked PR and keeps merged PRs at the bottom", async () => {
    const stack = [
      rawPr({ number: 50, headRefName: "feat/a", baseRefName: "main" }),
      rawPr({ number: 51, headRefName: "feat/b", baseRefName: "feat/a" }),
      rawPr({ number: 52, headRefName: "feat/c", baseRefName: "feat/b" }),
    ];
    const github = fakeGithub(stack);
    const { prs } = await service([doc({ prs: ["51"] })], github.runner);
    await prs.refresh();
    expect(prs.docPrs("api/plan.md").stack.map((item) => [item.number, item.linked])).toEqual([
      [50, false],
      [51, true],
      [52, false],
    ]);

    stack[0] = rawPr({ number: 50, headRefName: "feat/a", state: "MERGED", merged: true });
    stack[1] = rawPr({ number: 51, headRefName: "feat/b", baseRefName: "main" });
    await prs.refresh();
    expect(prs.docPrs("api/plan.md").stack.map((item) => [item.number, item.info?.state])).toEqual([
      [50, "merged"],
      [51, "open"],
      [52, "open"],
    ]);
  });

  it("offers completion once every linked PR merged, and only once per set of PRs", async () => {
    const github = fakeGithub([rawPr({ number: 60, state: "MERGED", merged: true }), rawPr({ number: 61 })]);
    const plan = doc({ prs: ["60", "61"] });
    const { prs } = await service([plan], github.runner);
    await prs.refresh();
    expect(prs.completionMarker(plan)).toBeNull();
    await prs.setUnlinked(plan.path, 61, true);
    expect(prs.completionMarker(plan)).toBe("60");
    await prs.markCompleted(plan.path, "60");
    expect(prs.completionMarker(plan)).toBeNull();
    expect(prs.completion(plan.path)).toEqual({ marker: "60", at: new Date(NOW).toISOString() });
  });

  it("raises inbox signals for failing CI, review feedback and closed PRs, and dismisses closed ones", async () => {
    const failing = { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE", contexts: { nodes: [] } } } }] };
    const github = fakeGithub([
      rawPr({ number: 70, commits: failing }),
      rawPr({ number: 71, reviewThreads: { nodes: [{ isResolved: false }] } }),
      rawPr({ number: 72, state: "CLOSED", closedAt: "2026-11-02T10:00:00Z" }),
    ]);
    const plan = doc({ prs: ["70", "71", "72"] });
    const { prs } = await service([plan], github.runner);
    await prs.refresh();
    expect(prs.signalsFor(plan).map((signal) => [signal.reason, signal.numbers])).toEqual([
      ["ci-failing", [70]],
      ["review-comments", [71]],
      ["pr-closed-unmerged", [72]],
    ]);
    expect(prs.attentionFor(plan)).toBe("ci-failing");
    await prs.dismissClosed(plan.path, [72]);
    expect(prs.signalsFor(plan).map((signal) => signal.reason)).not.toContain("pr-closed-unmerged");
  });

  it("reports when gh isn't available", async () => {
    const { GhUnavailableError } = await import("./ghClient.js");
    const runner: GraphqlRunner = async () => {
      throw new GhUnavailableError("The GitHub CLI (gh) isn't installed, so PR status is unavailable");
    };
    const { prs } = await service([doc({ prs: ["1"] })], runner);
    await prs.refresh();
    expect(prs.docPrs("api/plan.md")).toMatchObject({ status: "unavailable" });
  });
});
