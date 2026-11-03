import type { DocsIndex, IndexedDoc, RepoIndex } from "@timthink/server";
import { describe, expect, it } from "vitest";
import { parentHref, searchIndex } from "./navigation";

function doc(path: string, title: string, overrides: Partial<IndexedDoc> = {}): IndexedDoc {
  const [repo = "", ...rest] = path.split("/");
  return {
    path,
    repo,
    project: rest.length > 1 ? (rest[0] ?? null) : null,
    relPath: rest.join("/"),
    title,
    date: "2026-11-01",
    mtime: 1,
    status: null,
    branch: null,
    prs: [],
    linear: null,
    tasks: { done: 0, total: 0 },
    frontmatterError: null,
    archive: { state: "active" },
    ...overrides,
  };
}

function repo(name: string, ungrouped: IndexedDoc[], projects: RepoIndex["projects"] = []): RepoIndex {
  return {
    name,
    github: null,
    prLinks: "github",
    group: null,
    hidden: false,
    lastActivity: 0,
    docCount: ungrouped.length,
    activeCount: ungrouped.length,
    archivedCount: 0,
    projects,
    ungrouped,
    rootAttachmentCount: 0,
  };
}

const billingA = doc("acme/billing/a.md", "Billing cutover");
const billingB = doc("acme/billing/b.md", "Billing rollback");
const solo = doc("acme/solo/only.md", "Solo plan");
const rateLimiter = doc("acme/rate-limiter.md", "Rate limiter", { mtime: 5 });
const oldPlan = doc("garden/old.md", "Old billing idea", { archive: { state: "auto" }, mtime: 9 });

const INDEX: DocsIndex = {
  generatedAt: "",
  groups: null,
  sidebarQuotes: [],
  repos: [
    repo(
      "acme",
      [rateLimiter],
      [
        { name: "billing", docs: [billingA, billingB], attachmentCount: 0 },
        { name: "solo", docs: [solo], attachmentCount: 0 },
      ],
    ),
    repo("garden", [oldPlan]),
  ],
};

describe("parentHref", () => {
  it("goes plan → folder → repo → inbox, skipping single-plan folders", () => {
    expect(parentHref(INDEX, { repo: "acme", project: null, docPath: billingA.path })).toBe("/r/acme/billing");
    expect(parentHref(INDEX, { repo: "acme", project: null, docPath: solo.path })).toBe("/r/acme");
    expect(parentHref(INDEX, { repo: "acme", project: "billing", docPath: null })).toBe("/r/acme");
    expect(parentHref(INDEX, { repo: "acme", project: null, docPath: null })).toBe("/");
    expect(parentHref(INDEX, { repo: null, project: null, docPath: null })).toBeNull();
  });
});

describe("searchIndex", () => {
  it("lists recent active plans for an empty query", () => {
    expect(searchIndex(INDEX, "").map((result) => (result.kind === "plan" ? result.doc.path : result.repo))[0]).toBe(
      rateLimiter.path,
    );
    expect(searchIndex(INDEX, "").some((result) => result.kind === "plan" && result.doc === oldPlan)).toBe(false);
  });

  it("matches every term across title and path, ranking title hits and active plans first", () => {
    const paths = searchIndex(INDEX, "billing").map((result) =>
      result.kind === "plan" ? result.doc.path : result.repo,
    );
    expect(paths).toEqual([billingA.path, billingB.path, oldPlan.path]);
    expect(searchIndex(INDEX, "billing roll").map((result) => result.kind === "plan" && result.doc.path)).toEqual([
      billingB.path,
    ]);
    expect(searchIndex(INDEX, "gard")[0]).toEqual({ kind: "repo", repo: "garden" });
  });
});
