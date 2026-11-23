import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { DocsIndex, IndexedDoc } from "../docs/types.js";
import type { ChecklistResults } from "../pages/checklistStore.js";
import type { AuthoredPageView } from "../pages/pageBundle.js";
import type { PrInfo } from "../prs/types.js";
import type { ReviewView } from "../reviews/reviewService.js";
import { TOKEN_HEADER } from "../security.js";
import { createRuntime, type Runtime } from "../server.js";
import { copyFixtureDocs, makeTempDir, testConfig } from "../test/fixtures.js";
import { createGitRepo } from "../test/gitRepo.js";
import { parseProjectManifest } from "./manifest.js";
import {
  type AreaDetail,
  buildAreaDetail,
  buildProjectDetail,
  type ProjectDetail,
  type ProjectPrs,
  type ProjectThread,
  type ProjectViewDeps,
} from "./projectView.js";

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

  it("shows the project's sessions with status and label, bound by a doc write or by command", async () => {
    const sessionIdOf = (letter: string) => `${letter.repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
    const [writer, bound, ended, elsewhere] = [sessionIdOf("a"), sessionIdOf("b"), sessionIdOf("c"), sessionIdOf("d")];
    const stateDir = await makeTempDir();
    const live = [writer, bound, elsewhere].map((sessionId, pid) => ({
      pid: pid + 2,
      sessionId,
      updatedAt: 1,
      warpFocusUrl: null,
    }));
    runtime = await createRuntime({
      config: testConfig({ docsRoot, stateDir }),
      webDist: null,
      scanLiveProcesses: async () => live,
    });
    const at = (minute: number) => `2026-11-22T10:0${minute}:00.000Z`;
    const events = [
      { event: "SessionStart", sessionId: writer, at: at(0) },
      { event: "UserPromptSubmit", sessionId: writer, at: at(1) },
      { event: "Stop", sessionId: writer, at: at(2) },
      { event: "Notification", sessionId: writer, at: at(3) },
      { event: "SessionStart", sessionId: bound, at: at(0) },
      { event: "UserPromptSubmit", sessionId: bound, at: at(1) },
      { event: "Label", sessionId: bound, at: at(2), label: "Building phase 2" },
      { event: "Bind", sessionId: bound, at: at(2), project: CHECKOUT_ID },
      { event: "SessionStart", sessionId: ended, at: at(0) },
      { event: "SessionStart", sessionId: elsewhere, at: at(0) },
    ];
    await appendFile(
      path.join(stateDir, "sessions.jsonl"),
      events.map((event) => `${JSON.stringify(event)}\n`).join(""),
    );
    const plan = path.join(docsRoot, CHECKOUT_ID, "2026-11-10-checkout-v2-plan.md");
    const writes = [writer, ended].map((sessionId) => ({ sessionId, filePath: plan, at: at(0) }));
    await appendFile(
      path.join(stateDir, "doc-sessions.jsonl"),
      writes.map((write) => `${JSON.stringify(write)}\n`).join(""),
    );
    await runtime.sessions.readHookLogs();

    const { body } = await project(CHECKOUT_ID);
    const sessions: ProjectDetail["sessions"] = body.sessions;
    expect(sessions.map((session) => [session.id, session.status, session.title])).toEqual([
      [writer, "waiting", `Session ${writer.slice(0, 8)}`],
      [bound, "working", "Building phase 2"],
      [ended, "ended", `Session ${ended.slice(0, 8)}`],
    ]);
  });

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

  it("reindexes after the hub archives a project, though the edit already rescanned the registry", async () => {
    const watcher = runtime.startWatching();
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const statusInIndex = async () =>
        (await index()).areas.flatMap((area) => area.projects).find((entry) => entry.id === CHECKOUT_ID)?.status;
      expect(await statusInIndex()).toBe("active");
      expect((await post("/api/project/status", { id: CHECKOUT_ID, status: "shipped" })).status).toBe(200);
      await expect.poll(statusInIndex, { timeout: 3000 }).toBe("shipped");
    } finally {
      watcher.close();
    }
  });

  it("renames a project and a plan by title, leaving folders and files where they are", async () => {
    expect((await post("/api/project/title", { id: CHECKOUT_ID, title: "Checkout: v2" })).status).toBe(200);
    expect((await post("/api/project/title", { id: CHECKOUT_ID, title: " " })).status).toBe(400);
    const manifest = await readFile(path.join(docsRoot, CHECKOUT_ID, "project.yaml"), "utf8");
    expect(parseProjectManifest(manifest).manifest.title).toBe("Checkout: v2");

    const planPath = `${CHECKOUT_ID}/2026-11-10-checkout-v2-plan.md`;
    expect((await post("/api/doc/title", { path: planPath, title: "Saved cards at checkout" })).status).toBe(200);
    expect((await post("/api/doc/title", { path: `${CHECKOUT_ID}/project.yaml`, title: "Nope" })).status).toBe(404);
    const raw = await readFile(path.join(docsRoot, planPath), "utf8");
    expect(raw).toMatch(/^---\n(?:.*\n)*title: Saved cards at checkout\n/);
    await runtime.store.applyChanges([planPath]);
    expect(docIn((await project(CHECKOUT_ID)).body.project.docs, "checkout-v2-plan.md")?.title).toBe(
      "Saved cards at checkout",
    );
  });

  it("serves a project's authored page, rebuilt when an imported file changes", async () => {
    const page = async () => {
      const response = await runtime.app.request(`${BASE}/api/project/page?id=${encodeURIComponent(CHECKOUT_ID)}`);
      const body: AuthoredPageView = await response.json();
      return body;
    };
    expect(await page()).toEqual({ kind: "none" });

    const projectDir = path.join(docsRoot, CHECKOUT_ID);
    await writeFile(path.join(projectDir, "steps.ts"), 'export const steps = ["seed"];\n');
    await writeFile(
      path.join(projectDir, "project.page.tsx"),
      'import { Section } from "timthink/page";\nimport { steps } from "./steps";\nexport default () => <Section id="a" title="A">{steps}</Section>;\n',
    );
    const built = await page();
    expect(built.kind).toBe("built");
    expect(built.kind === "built" && built.code).toContain('require("timthink/page")');
    expect(await page()).toEqual(built);

    await writeFile(path.join(projectDir, "steps.ts"), 'export const steps = ["seed", "log in"];\n');
    const rebuilt = await page();
    expect(rebuilt.kind === "built" && built.kind === "built" && rebuilt.hash !== built.hash).toBe(true);

    await writeFile(path.join(projectDir, "steps.ts"), "export const steps = [;\n");
    const failed = await page();
    expect(failed.kind === "failed" && failed.errors[0]?.file).toBe(`${CHECKOUT_ID}/steps.ts`);
  });

  it("reviews a page block by its id and outdates the thread when the id goes", async () => {
    const pagePath = `${CHECKOUT_ID}/project.page.tsx`;
    const source =
      'import { Section } from "timthink/page";\nexport default () => <Section id="setup" title="Setup">Seed</Section>;\n';
    await writeFile(path.join(docsRoot, pagePath), source);
    const page = await runtime.app.request(`${BASE}/api/project/page?id=${encodeURIComponent(CHECKOUT_ID)}`);
    const view: AuthoredPageView = await page.json();
    if (view.kind !== "built") throw new Error(`page didn't build: ${view.kind}`);
    const start = source.indexOf('id="setup"');

    const created = await post("/api/review/threads", {
      path: pagePath,
      version: 0,
      docHash: view.sourceHash,
      start,
      end: start + 'id="setup"'.length,
      kind: "comment",
      body: "Add the 3DS card here.",
      suggestion: null,
    });
    const draft: ReviewView = await created.json();
    expect(created.status).toBe(200);
    await post("/api/review/submit", { path: pagePath, version: draft.version, verdict: "approve", body: "" });
    expect(await readFile(path.join(docsRoot, pagePath), "utf8")).toBe(source);

    const { body } = await project(CHECKOUT_ID);
    expect(body.threads.map((thread: ProjectThread) => [thread.docPath, thread.quote, thread.waitingOn])).toEqual([
      [pagePath, 'id="setup"', "claude"],
    ]);

    await writeFile(path.join(docsRoot, pagePath), source.replace('id="setup"', 'id="seeding-households"'));
    const review = await runtime.app.request(`${BASE}/api/review?path=${encodeURIComponent(pagePath)}`);
    const after: ReviewView = await review.json();
    expect(after.threads.map((thread) => thread.status)).toEqual(["outdated"]);
  });

  it("serves an area's page and keeps its checklists apart from its projects'", async () => {
    const area = async () => runtime.app.request(`${BASE}/api/area?id=payments`);
    const detail: AreaDetail = await (await area()).json();
    expect(detail.area.projects.map((entry) => entry.id)).toEqual([CHECKOUT_ID, "payments/refunds"]);
    expect((await runtime.app.request(`${BASE}/api/area?id=nope`)).status).toBe(404);

    await writeFile(
      path.join(docsRoot, "payments", "area.page.tsx"),
      'import { Section, useArea } from "timthink/page";\nexport default () => <Section id="households" title={useArea().area.title} />;\n',
    );
    const page = await runtime.app.request(`${BASE}/api/area/page?id=payments`);
    const view: AuthoredPageView = await page.json();
    expect(view.kind === "built" && view.source).toContain('id="households"');

    expect(
      (
        await post("/api/project/checklist", {
          id: "payments",
          checklist: "smoke",
          step: "seed",
          result: { outcome: "pass", note: "", sha: null },
        })
      ).status,
    ).toBe(200);
    const stored = await readFile(path.join(docsRoot, "payments/.timthink/checklists/_area/smoke.json"), "utf8");
    expect(JSON.parse(stored).steps.seed).toMatchObject({ outcome: "pass" });
  });

  it("records checklist steps against a head SHA and clears them", async () => {
    const checklist = async () => {
      const response = await runtime.app.request(
        `${BASE}/api/project/checklist?id=${encodeURIComponent(CHECKOUT_ID)}&checklist=saved-cards`,
      );
      const body: ChecklistResults = await response.json();
      return body;
    };
    const step = (result: unknown) =>
      post("/api/project/checklist", { id: CHECKOUT_ID, checklist: "saved-cards", step: "pay", result });
    expect(await checklist()).toEqual({ steps: {} });

    expect((await step({ outcome: "fail", note: "3DS loops", sha: "abc1234" })).status).toBe(200);
    expect((await checklist()).steps.pay).toMatchObject({ outcome: "fail", note: "3DS loops", sha: "abc1234" });
    expect(
      await readFile(path.join(docsRoot, "payments/.timthink/checklists/checkout-v2/saved-cards.json"), "utf8"),
    ).toContain("3DS loops");

    expect((await step({ outcome: "pass", note: "", sha: "../etc" })).status).toBe(400);
    expect((await step(null)).status).toBe(200);
    expect(await checklist()).toEqual({ steps: {} });
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
      headSha: null,
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
      awaitingCompletion: () => null,
      sessionsOf: async () => [],
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

describe("area PR rollup", () => {
  it("lists each live project's unsettled stacks and leaves out settled ones", () => {
    const pr = (number: number, state: PrInfo["state"]): ProjectPrs["stacks"][number]["prs"][number] => ({
      repo: "acme-api",
      number,
      sources: [],
      docPaths: [],
      info: {
        owner: "acme",
        repo: "acme-api",
        number,
        title: `PR ${number}`,
        url: "",
        author: null,
        state,
        ci: null,
        failingChecks: [],
        review: null,
        unresolvedThreads: 0,
        headRef: `branch-${number}`,
        headSha: null,
        baseRef: "main",
        closedAt: null,
        mergedAt: null,
        updatedAt: "2026-11-22T00:00:00.000Z",
      },
    });
    const project = (id: string, status: "active" | "shipped") => ({
      id,
      area: "payments",
      slug: id.split("/")[1] ?? id,
      title: id,
      summary: null,
      status,
      repos: ["acme-api"],
      problems: [],
      docs: [],
      attachmentCount: 0,
      lastActivity: 0,
    });
    const stacksByProject: Record<string, ProjectPrs["stacks"]> = {
      "payments/checkout": [
        { repo: "acme-api", prs: [pr(1, "merged"), pr(2, "open")] },
        { repo: "acme-api", prs: [pr(3, "merged")] },
      ],
      "payments/quiet": [{ repo: "acme-api", prs: [pr(4, "closed")] }],
      "payments/refunds": [{ repo: "acme-api", prs: [pr(5, "open")] }],
    };
    const detail = buildAreaDetail({
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
              project("payments/checkout", "active"),
              project("payments/quiet", "active"),
              project("payments/refunds", "shipped"),
            ],
          },
        ],
      },
      areaId: "payments",
      prsOf: (entry) => ({ status: "ok", message: null, stacks: stacksByProject[entry.id] ?? [], detached: [] }),
    });
    expect(
      detail?.projectPrs.map((entry) => [
        entry.projectId,
        entry.prs.stacks.map((stack) => stack.prs.map((item) => item.number)),
      ]),
    ).toEqual([["payments/checkout", [[1, 2]]]]);
  });
});
