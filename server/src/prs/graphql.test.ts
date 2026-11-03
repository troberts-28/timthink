import { describe, expect, it } from "vitest";
import { buildRepoQuery, landedOnTrunk, parseRepoQuery } from "./graphql.js";

describe("buildRepoQuery", () => {
  it("batches PRs, neighbour lookups and trunk checks into one repository query", () => {
    const query = buildRepoQuery({
      owner: "acme",
      repo: "api",
      numbers: [12, 13],
      parentsOf: ["feat/a"],
      childrenOf: ['feat/"b"'],
      mergeChecks: [{ number: 13, closedAt: "2026-11-02T17:00:00Z" }],
      trunk: "main",
    });
    expect(query).toContain('repository(owner: "acme", name: "api")');
    expect(query).toContain("p12: pullRequest(number: 12) { ...P }");
    expect(query).toContain('h0: pullRequests(headRefName: "feat/a"');
    expect(query).toContain('b0: pullRequests(baseRefName: "feat/\\"b\\""');
    expect(query).toContain(
      'm13: object(expression: "main") { ... on Commit { history(first: 100, since: "2026-11-02T11:00:00.000Z", until: "2026-11-02T17:10:00.000Z") { nodes { message } }',
    );
  });

  it("leaves the PR fragment out of a query that only checks the trunk", () => {
    const query = buildRepoQuery({
      owner: "acme",
      repo: "api",
      numbers: [],
      parentsOf: [],
      childrenOf: [],
      mergeChecks: [{ number: 13, closedAt: "2026-11-02T17:00:00Z" }],
      trunk: null,
    });
    expect(query).toContain('m13: object(expression: "HEAD")');
    expect(query).not.toContain("fragment P");
  });
});

describe("parseRepoQuery", () => {
  it("collects PRs from every alias, skips missing ones and keeps trunk headlines", () => {
    const pr = { number: 7, headRefName: "feat/x" };
    const result = parseRepoQuery({
      data: {
        repository: {
          defaultBranchRef: { name: "trunk" },
          p7: pr,
          p8: null,
          b0: { nodes: [{ number: 9, headRefName: "feat/y" }] },
          m7: { history: { nodes: [{ message: "fix: x (#7)\n\nBody text (#99)" }] } },
        },
      },
    });
    expect(result.trunk).toBe("trunk");
    expect(result.prs.map((raw) => raw.number)).toEqual([7, 9]);
    expect(result.mergeHeadlines.get(7)).toEqual(["fix: x (#7)"]);
  });

  it("returns nothing for an error response", () => {
    expect(parseRepoQuery({ errors: [{ message: "Bad credentials" }] }).prs).toEqual([]);
  });
});

describe("landedOnTrunk", () => {
  it("matches only the exact PR number at the end of a headline", () => {
    expect(landedOnTrunk(12, ["feat: thing (#12)"])).toBe(true);
    expect(landedOnTrunk(12, ["feat: thing (#120)", "revert (#12) later"])).toBe(false);
  });
});
