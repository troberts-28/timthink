import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { DocsIndex, IndexedDoc } from "../docs/types.js";
import type { PrInfo } from "../prs/types.js";
import { TOKEN_HEADER } from "../security.js";
import { createRuntime, type Runtime } from "../server.js";
import { copyFixtureDocs, testConfig } from "../test/fixtures.js";
import { createGitRepo } from "../test/gitRepo.js";
import { parseProjectManifest } from "./manifest.js";
import { buildProjectDetail, type ProjectDetail, type ProjectViewDeps } from "./projectView.js";

const BASE = "http://127.0.0.1:7420";
const CHECKOUT_ID = "payments/checkout-v2";

describe("projects API", () => {
  let runtime: Runtime;
  let docsRoot: string;

  beforeEach(async () => {
    docsRoot = await copyFixtureDocs();
    const repo = await createGitRepo("acme-api");
    runtime = await createRuntime({ config: testConfig({ docsRoot, codeRoot: repo.codeRoot }), webDist: null });
  });

  async function index() {
    const response = await runtime.app.request(`${BASE}/api/index`);
    const body: DocsIndex = await response.json();
    return body;
  }

  async function project(id: string) {
    const response = await runtime.app.request(`${BASE}/api/project?id=${encodeURIComponent(id)}`);
    return { status: response.status, body: response.status === 200 ? await response.json() : null };
  }

  function post(url: string, body: unknown) {
    return runtime.app.request(`${BASE}${url}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: BASE, [TOKEN_HEADER]: runtime.token },
    });
  }

  function docIn(docs: readonly IndexedDoc[], fileName: string) {
    return docs.find((doc) => doc.path.endsWith(fileName));
  }

  it("indexes areas and projects apart from the legacy repos", async () => {
    const { areas, repos, codeRepos } = await index();
    expect(repos.map((repo) => repo.name).sort()).toEqual(["acme-api", "garden-app"]);
    const payments = areas.find((area) => area.id === "payments");
    expect(payments?.projects.map((entry) => [entry.id, entry.status])).toEqual([
      [CHECKOUT_ID, "active"],
      ["payments/refunds", "shipped"],
    ]);
    expect(payments?.docs.map((doc) => [doc.kind, doc.codeRepo])).toEqual([["research", "acme-api"]]);
    expect(codeRepos["acme-api"]?.github).toEqual({ owner: "acme", repo: "acme-api" });
  });

  it("gives each project doc its project, kind and code repo", async () => {
    const checkout = (await index()).areas.flatMap((area) => area.projects).find((entry) => entry.id === CHECKOUT_ID);
    const docs = checkout?.docs ?? [];
    expect(docIn(docs, "checkout-v2-plan.md")).toMatchObject({
      projectId: CHECKOUT_ID,
      kind: "plan",
      codeRepo: "acme-api",
    });
    expect(docIn(docs, "saved-cards-research.md")).toMatchObject({ kind: "research", codeRepo: "acme-api" });
    expect(docIn(docs, "checkout-handoff.md")).toMatchObject({ kind: "handoff", codeRepo: "garden-app" });
  });

  it("archives a shipped project's docs whatever their age", async () => {
    const refunds = (await index()).areas
      .flatMap((area) => area.projects)
      .find((entry) => entry.id === "payments/refunds");
    expect(refunds?.docs.map((doc) => doc.archive.state)).toEqual(["auto"]);
  });

  it("rolls up a project's open questions and reports PRs as disabled without gh", async () => {
    const { status, body } = await project(CHECKOUT_ID);
    expect(status).toBe(200);
    const detail: ProjectDetail = body;
    expect(detail.area).toEqual({ id: "payments", title: "Payments" });
    expect(detail.questions.map((question) => [question.questionId, question.answered])).toEqual([
      ["saved-card-default", false],
    ]);
    expect(detail.prs.status).toBe("disabled");
    expect((await project("payments/missing")).status).toBe(404);
  });

  it("links, detaches and settles a project through its manifest", async () => {
    const manifestPath = path.join(docsRoot, CHECKOUT_ID, "project.yaml");
    expect(
      (await post("/api/project/pr", { id: CHECKOUT_ID, repo: "garden-app", number: 12, action: "link" })).status,
    ).toBe(200);
    expect(
      (await post("/api/project/pr", { id: CHECKOUT_ID, repo: "acme-api", number: 4300, action: "unlink" })).status,
    ).toBe(200);
    expect((await post("/api/project/status", { id: CHECKOUT_ID, status: "paused" })).status).toBe(200);
    const text = await readFile(manifestPath, "utf8");
    expect(parseProjectManifest(text).manifest).toMatchObject({
      status: "paused",
      prs: [{ repo: "garden-app", number: 12 }],
      detached: [{ repo: "acme-api", number: 4300 }],
    });
    expect(text).toContain("summary: One-page checkout with saved cards.");
    expect((await post("/api/project/status", { id: "nope", status: "paused" })).status).toBe(404);
  });

  it("keeps a project listed with its problems when the manifest is invalid", async () => {
    await writeFile(
      path.join(docsRoot, CHECKOUT_ID, "project.yaml"),
      "status: someday\nrepos: [acme-api]\nprs: [4300, not-a-pr]\n",
    );
    await runtime.projects.scan();
    const checkout = runtime.projects.project(CHECKOUT_ID);
    expect(checkout?.manifest).toMatchObject({ status: "active", prs: [{ repo: "acme-api", number: 4300 }] });
    expect(checkout?.problems).toHaveLength(2);
  });
});

describe("project PRs", () => {
  const github = { owner: "acme", repo: "acme-api" };

  function info(number: number, state: PrInfo["state"]): PrInfo {
    return {
      owner: "acme",
      repo: "acme-api",
      number,
      title: `PR ${number}`,
      url: `https://github.com/acme/acme-api/pull/${number}`,
      author: null,
      state,
      ci: null,
      failingChecks: [],
      review: null,
      unresolvedThreads: 0,
      headRef: `b${number}`,
      baseRef: "main",
      closedAt: null,
      mergedAt: state === "merged" ? "2026-11-01T00:00:00.000Z" : null,
      updatedAt: "2026-11-02T00:00:00.000Z",
    };
  }

  function doc(name: string): IndexedDoc {
    return {
      path: `payments/checkout-v2/${name}`,
      repo: "payments",
      project: null,
      projectId: CHECKOUT_ID,
      codeRepo: "acme-api",
      repoOverride: null,
      kind: "plan",
      relPath: `checkout-v2/${name}`,
      title: name,
      date: "2026-11-10",
      mtime: Date.parse("2026-11-10T00:00:00.000Z"),
      status: null,
      branch: null,
      prs: [],
      linear: null,
      tasks: { done: 0, total: 0 },
      frontmatterError: null,
      archive: { state: "active" },
      prAttention: null,
    };
  }

  it("merges overlapping stacks across docs and the manifest, minus detached PRs", async () => {
    const plan = doc("plan.md");
    const followUp = doc("follow-up.md");
    const states: Record<number, PrInfo["state"]> = { 1: "merged", 2: "open", 3: "open", 4: "open", 9: "open" };
    const deps: ProjectViewDeps = {
      index: {
        generatedAt: "",
        groups: null,
        sidebarQuotes: [],
        repos: [],
        projects: [],
        codeRepos: {},
        areas: [
          {
            id: "payments",
            title: "Payments",
            summary: null,
            repos: ["acme-api"],
            problems: [],
            docs: [],
            lastActivity: 0,
            projects: [
              {
                id: CHECKOUT_ID,
                area: "payments",
                slug: "checkout-v2",
                title: "Checkout v2",
                summary: null,
                status: "active",
                repos: ["acme-api"],
                problems: [],
                docs: [plan, followUp],
                attachmentCount: 0,
                lastActivity: 0,
              },
            ],
          },
        ],
      },
      record: {
        id: CHECKOUT_ID,
        area: "payments",
        slug: "checkout-v2",
        problems: [],
        manifest: {
          title: "Checkout v2",
          summary: null,
          status: "active",
          repos: ["acme-api"],
          prs: [{ repo: "acme-api", number: 9 }],
          detached: [{ repo: "acme-api", number: 4 }],
        },
      },
      contentOf: () => undefined,
      readReview: async () => null,
      docPrs: (docPath) =>
        docPath === plan.path
          ? { linked: [{ number: 2, sources: ["frontmatter"] }], stack: [{ number: 1 }, { number: 2 }] }
          : { linked: [{ number: 3, sources: ["session"] }], stack: [{ number: 2 }, { number: 3 }, { number: 4 }] },
      githubFor: (repo) => (repo === "acme-api" ? github : null),
      lookupPrs: () => {},
      infoFor: (_github, number) => info(number, states[number] ?? "open"),
      stackOf: (_github, numbers) => numbers,
      prsEnabled: true,
      prsUnavailable: null,
      attachmentsUnder: () => [],
      rounds: [],
    };
    const detail = await buildProjectDetail(deps);
    expect(detail?.prs.stacks.map((stack) => stack.prs.map((pr) => [pr.number, pr.sources]))).toEqual([
      [[9, ["manifest"]]],
      [
        [1, ["stack"]],
        [2, ["frontmatter"]],
        [3, ["session"]],
      ],
    ]);
    expect(detail?.prs.detached.map((pr) => pr.number)).toEqual([4]);
    expect(detail?.activity.map((entry) => entry.kind)).toContain("pr-merged");
  });
});
