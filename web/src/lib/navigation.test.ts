import type { DocsIndex, IndexedDoc, RepoIndex } from "@timthink/server";
import { describe, expect, it } from "vitest";
import { parentHref, searchIndex } from "./navigation";
import { selectionFromPath } from "./selection";

function doc(path: string, title: string, overrides: Partial<IndexedDoc> = {}): IndexedDoc {
  const [repo = "", ...rest] = path.split("/");
  return {
    path,
    repo,
    project: rest.length > 1 ? (rest[0] ?? null) : null,
    projectId: null,
    codeRepo: repo,
    repoOverride: null,
    kind: "plan",
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
    prAttention: null,
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
    buildLauncher: false,
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
const checkoutPlan = doc("payments/checkout/plan.md", "Checkout plan", { projectId: "payments/checkout" });
const areaResearch = doc("payments/research.md", "Processor research", { kind: "research" });
const oldPlan = doc("garden/old.md", "Old billing idea", { archive: { state: "auto" }, mtime: 9 });

const INDEX: DocsIndex = {
  generatedAt: "",
  groups: null,
  sidebarQuotes: [],
  areas: [
    {
      id: "payments",
      title: "Payments",
      summary: null,
      repos: ["acme"],
      problems: [],
      docs: [areaResearch],
      lastActivity: 0,
      projects: [
        {
          id: "payments/checkout",
          area: "payments",
          slug: "checkout",
          title: "Checkout",
          summary: null,
          status: "active",
          repos: ["acme"],
          problems: [],
          docs: [checkoutPlan],
          attachmentCount: 0,
          lastActivity: 0,
        },
      ],
    },
  ],
  projects: [],
  codeRepos: {},
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
    expect(parentHref(INDEX, selectionFromPath(`/d/${billingA.path}`))).toBe("/r/acme/billing");
    expect(parentHref(INDEX, selectionFromPath(`/d/${solo.path}`))).toBe("/r/acme");
    expect(parentHref(INDEX, selectionFromPath("/r/acme/billing"))).toBe("/r/acme");
    expect(parentHref(INDEX, selectionFromPath("/r/acme"))).toBe("/");
    expect(parentHref(INDEX, selectionFromPath("/"))).toBeNull();
  });

  it("goes project doc → project → area → inbox", () => {
    expect(parentHref(INDEX, selectionFromPath(`/d/${checkoutPlan.path}`))).toBe("/p/payments/checkout");
    expect(parentHref(INDEX, selectionFromPath(`/d/${areaResearch.path}`))).toBe("/a/payments");
    expect(parentHref(INDEX, selectionFromPath("/p/payments/checkout"))).toBe("/a/payments");
    expect(parentHref(INDEX, selectionFromPath("/a/payments"))).toBe("/");
  });
});

describe("searchIndex", () => {
  it("lists recent active plans for an empty query", () => {
    expect(
      searchIndex(INDEX, "").map((result) =>
        result.kind === "plan" ? result.doc.path : result.kind === "repo" ? result.repo : null,
      )[0],
    ).toBe(rateLimiter.path);
    expect(searchIndex(INDEX, "").some((result) => result.kind === "plan" && result.doc === oldPlan)).toBe(false);
  });

  it("matches every term across title and path, ranking title hits and active plans first", () => {
    const paths = searchIndex(INDEX, "billing").map((result) =>
      result.kind === "plan" ? result.doc.path : result.kind === "repo" ? result.repo : null,
    );
    expect(paths).toEqual([billingA.path, billingB.path, oldPlan.path]);
    expect(searchIndex(INDEX, "billing roll").map((result) => result.kind === "plan" && result.doc.path)).toEqual([
      billingB.path,
    ]);
    expect(searchIndex(INDEX, "gard")[0]).toEqual({ kind: "repo", repo: "garden" });
  });
});
