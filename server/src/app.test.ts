import { appendFile, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionActionResponse } from "./app.js";
import type { OpenInEditor } from "./code/editor.js";
import type { DocDetail, DocsIndex } from "./docs/types.js";
import type { HubEvent } from "./events.js";
import type { ReviewView } from "./reviews/reviewService.js";
import { TOKEN_HEADER } from "./security.js";
import { createRuntime, type Runtime } from "./server.js";
import type { SessionsResponse } from "./sessions/types.js";
import type { OpenUrl } from "./sessions/warp.js";
import { copyClaudeProjects, copyFixtureDocs, makeTempDir, testConfig } from "./test/fixtures.js";
import { createGitRepo, git } from "./test/gitRepo.js";

const BASE = "http://127.0.0.1:7420";

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
const ORIGIN = "http://127.0.0.1:7420";

describe("HTTP API", () => {
  let runtime: Runtime;
  let docsRoot: string;
  let checkout: string;
  const openInEditor = vi.fn<OpenInEditor>(async () => {});

  beforeAll(async () => {
    docsRoot = await copyFixtureDocs();
    const repo = await createGitRepo("acme-api");
    checkout = repo.checkout;
    runtime = await createRuntime({
      config: testConfig({ docsRoot, codeRoot: repo.codeRoot }),
      webDist: null,
      openInEditor,
    });
  });

  const get = (url: string, headers: Record<string, string> = {}) => runtime.app.request(`${BASE}${url}`, { headers });

  const post = (url: string, body: unknown, headers: Record<string, string>) =>
    runtime.app.request(`${BASE}${url}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    });

  it("serves the index with GitHub info from the checkout remote", async () => {
    const response = await get("/api/index");
    const index = await json<DocsIndex>(response);
    expect(index.repos.find((repo) => repo.name === "acme-api")?.github).toEqual({ owner: "acme", repo: "acme-api" });
    expect(index.repos.find((repo) => repo.name === "acme-api")?.prLinks).toBe("graphite");
    expect(index.repos.find((repo) => repo.name === "garden-app")?.github).toBeNull();
  });

  it("serves a doc with raw markdown, frontmatter and attachments", async () => {
    const response = await get("/api/doc?path=acme-api/2026-10-01-rate-limiter-plan.md");
    const doc = await json<DocDetail>(response);
    expect(doc.raw.startsWith("---\ntitle: Rate limiter")).toBe(true);
    expect(doc.frontmatter.pr).toBe(4211);
    expect(doc.attachments.map((file) => file.relPath)).toEqual(["2026-10-01-rate-limiter-demo.html"]);
    expect((await get("/api/doc?path=acme-api/missing.md")).status).toBe(404);
  });

  it("lists attachments for a project on demand", async () => {
    const response = await get("/api/attachments?repo=acme-api&project=billing-migration");
    const { attachments } = await json<{ attachments: Array<{ relPath: string }> }>(response);
    expect(attachments.map((file) => file.relPath)).toEqual([
      "billing-migration/data/sample-invoices.json",
      "billing-migration/diagrams/flow.png",
    ]);
  });

  it("rejects requests addressed to non-loopback hosts", async () => {
    const response = await runtime.app.request("http://evil.example:7420/api/index");
    expect(response.status).toBe(403);
  });

  describe("attachments", () => {
    it("streams files with their content type and a sandbox CSP", async () => {
      const response = await get("/api/attachment?path=acme-api/billing-migration/diagrams/flow.png");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    });

    it("serves the same files by path for demo embeds", async () => {
      const response = await get("/api/raw/acme-api/2026-10-01-rate-limiter-demo.html");
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).toContain("Requests left");
    });

    it.each(["../outside.txt", "acme-api/../../outside.txt", "/etc/passwd", "acme-api/%2e%2e/%2e%2e/outside.txt"])(
      "rejects traversal: %s",
      async (attempt) => {
        await writeFile(path.join(docsRoot, "..", "outside.txt"), "secret");
        const response = await get(`/api/attachment?path=${encodeURIComponent(attempt)}`);
        expect([403, 404]).toContain(response.status);
        expect(await response.text()).not.toContain("secret");
      },
    );

    it("rejects encoded traversal on the raw route", async () => {
      const response = await get("/api/raw/acme-api/..%2F..%2Foutside.txt");
      expect([403, 404]).toContain(response.status);
    });

    it("rejects symlinks that escape the docs root", async () => {
      const outside = await makeTempDir();
      await writeFile(path.join(outside, "secret.txt"), "secret");
      await symlink(path.join(outside, "secret.txt"), path.join(docsRoot, "acme-api", "escape.txt"));
      const response = await get("/api/attachment?path=acme-api/escape.txt");
      expect(response.status).toBe(403);
    });
  });

  describe("mutations", () => {
    const body = { repo: "acme-api", ref: "src/middleware/rateLimit.ts:42" };

    it("rejects a missing or foreign Origin", async () => {
      expect((await post("/api/open-code", body, { [TOKEN_HEADER]: runtime.token })).status).toBe(403);
      const foreign = await post("/api/open-code", body, {
        origin: "https://evil.example",
        [TOKEN_HEADER]: runtime.token,
      });
      expect(foreign.status).toBe(403);
    });

    it("rejects a missing or wrong token", async () => {
      expect((await post("/api/open-code", body, { origin: ORIGIN })).status).toBe(403);
      expect((await post("/api/open-code", body, { origin: ORIGIN, [TOKEN_HEADER]: "nope" })).status).toBe(403);
      expect(openInEditor).not.toHaveBeenCalled();
    });

    it("opens a uniquely resolved path in the editor", async () => {
      const response = await post("/api/open-code", body, { origin: ORIGIN, [TOKEN_HEADER]: runtime.token });
      expect(await response.json()).toMatchObject({
        status: "opened",
        match: { relPath: "src/middleware/rateLimit.ts" },
      });
      expect(openInEditor).toHaveBeenCalledWith(path.join(checkout, "src/middleware/rateLimit.ts"), 42, null);
    });

    it("returns candidates instead of opening when ambiguous", async () => {
      openInEditor.mockClear();
      const response = await post(
        "/api/open-code",
        { repo: "acme-api", ref: "tokens.ts" },
        {
          origin: ORIGIN,
          [TOKEN_HEADER]: runtime.token,
        },
      );
      const result = await json<{ status: string; matches: unknown[] }>(response);
      expect(result.status).toBe("ambiguous");
      expect(result.matches).toHaveLength(2);
      expect(openInEditor).not.toHaveBeenCalled();
    });
  });

  describe("session token", () => {
    it("is served to same-origin requests only", async () => {
      expect((await get("/api/session-token", { "sec-fetch-site": "same-origin" })).status).toBe(200);
      expect((await get("/api/session-token", { "sec-fetch-site": "cross-site" })).status).toBe(403);
      expect((await get("/api/session-token", { origin: "https://evil.example" })).status).toBe(403);
    });
  });
});

describe("sessions API", () => {
  const SESSION_A = "11111111-1111-4111-8111-111111111111";
  const SESSION_B = "22222222-2222-4222-8222-222222222222";
  const PANE = "warp://session/0123456789abcdef0123456789abcdef";
  const RATE_LIMITER = "acme-api/2026-10-01-rate-limiter-plan.md";
  const BILLING = "acme-api/billing-migration/2026-10-20-billing-migration-plan.md";
  let runtime: Runtime;
  let stateDir: string;
  let warpTabConfigDir: string;
  let codeRoot: string;
  const openUrl = vi.fn<OpenUrl>(async () => {});
  const events: HubEvent[] = [];

  const post = (url: string) =>
    runtime.app.request(`${BASE}${url}`, {
      method: "POST",
      headers: { origin: ORIGIN, [TOKEN_HEADER]: runtime.token },
    });

  beforeAll(async () => {
    const docsRoot = await copyFixtureDocs();
    const repo = await createGitRepo("acme-api");
    codeRoot = repo.codeRoot;
    git(repo.checkout, "worktree", "add", "-q", "-b", "feat/billing", path.join(codeRoot, "acme-api-2"));
    stateDir = await makeTempDir("timthink-state-");
    warpTabConfigDir = path.join(await makeTempDir(), "tab_configs");
    const claudeProjectsDir = await copyClaudeProjects({ docsRoot, codeRoot });
    await writeFile(path.join(docsRoot, BILLING), "---\ntitle: Billing\nbranch: feat/billing\n---\n# Billing\n");
    runtime = await createRuntime({
      config: testConfig({
        docsRoot,
        codeRoot,
        stateDir,
        claudeProjectsDir,
        warpTabConfigDir,
        repos: { "acme-api": { worktrees: path.join(codeRoot, "acme-api-*") } },
      }),
      webDist: null,
      openUrl,
    });
    runtime.hub.subscribe((event) => events.push(event));
    await runtime.sessions.runBackfill();
  });

  it("lists the sessions linked to a doc, newest first", async () => {
    const response = await runtime.app.request(`${BASE}/api/doc-sessions?path=${encodeURIComponent(RATE_LIMITER)}`);
    const body = await json<SessionsResponse>(response);
    expect(body.scanning).toBe(false);
    expect(body.sessions).toEqual([
      {
        id: SESSION_A,
        title: "Rate limiter plan",
        cwd: path.join(codeRoot, "acme-api"),
        branch: "feat/rate-limiter",
        firstSeen: "2026-10-01T09:00:00.000Z",
        lastActivity: "2026-10-01T10:30:00.000Z",
        live: false,
        warpFocusUrl: null,
        canResume: true,
      },
    ]);
  });

  it("lists recent sessions for a repo", async () => {
    const response = await runtime.app.request(`${BASE}/api/sessions?repo=acme-api`);
    const body = await json<SessionsResponse>(response);
    expect(body.sessions.map((session) => session.id)).toEqual([SESSION_B, SESSION_A]);
  });

  it("resolves code refs in the linked session's worktree when it is on the plan's branch", async () => {
    await writeFile(path.join(codeRoot, "acme-api-2", "only-in-worktree.ts"), "");
    const response = await runtime.app.request(
      `${BASE}/api/resolve-code?repo=acme-api&ref=only-in-worktree.ts&docPath=${encodeURIComponent(BILLING)}`,
    );
    expect(await response.json()).toMatchObject({ status: "resolved", matches: [{ relPath: "only-in-worktree.ts" }] });
    const elsewhere = await runtime.app.request(
      `${BASE}/api/resolve-code?repo=acme-api&ref=only-in-worktree.ts&docPath=${encodeURIComponent(RATE_LIMITER)}`,
    );
    expect(await elsewhere.json()).toEqual({ status: "not-found" });
  });

  it("refuses to focus a session that isn't live, and focuses a live one", async () => {
    const notLive = await post(`/api/sessions/${SESSION_A}/focus`);
    expect(await json<SessionActionResponse>(notLive)).toMatchObject({ status: "unavailable" });
    expect(openUrl).not.toHaveBeenCalled();

    await appendFile(
      path.join(stateDir, "sessions.jsonl"),
      `${JSON.stringify({ event: "SessionStart", sessionId: SESSION_A, at: new Date().toISOString(), cwd: "/x", warpFocusUrl: PANE })}\n`,
    );
    await runtime.sessions.readHookLogs();
    expect(events.at(-1)).toMatchObject({
      type: "sessions-changed",
      sessionIds: [SESSION_A],
      docPaths: [RATE_LIMITER],
    });

    const focused = await post(`/api/sessions/${SESSION_A}/focus`);
    expect(await json<SessionActionResponse>(focused)).toEqual({ status: "focused" });
    expect(openUrl).toHaveBeenCalledWith(PANE);
  });

  it("never opens a focus URL that isn't a Warp session link", async () => {
    openUrl.mockClear();
    await appendFile(
      path.join(stateDir, "sessions.jsonl"),
      `${JSON.stringify({ event: "SessionStart", sessionId: SESSION_B, at: new Date().toISOString(), warpFocusUrl: "https://evil.example" })}\n`,
    );
    await runtime.sessions.readHookLogs();
    const response = await post(`/api/sessions/${SESSION_B}/focus`);
    expect(await json<SessionActionResponse>(response)).toMatchObject({ status: "unavailable" });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("resumes a session in a new Warp tab at its directory", async () => {
    openUrl.mockClear();
    const response = await post(`/api/sessions/${SESSION_B}/resume`);
    expect(await json<SessionActionResponse>(response)).toEqual({
      status: "resumed",
      cwd: path.join(codeRoot, "acme-api-2"),
    });
    const config = await readFile(path.join(warpTabConfigDir, "timthink-resume.toml"), "utf8");
    expect(config).toContain(`directory = "${path.join(codeRoot, "acme-api-2")}"`);
    expect(config).toContain(`commands = ["claude --resume ${SESSION_B}"]`);
    expect(openUrl).toHaveBeenCalledWith("warp://tab_config/timthink-resume");
  });

  it("rejects unknown sessions, missing directories and unauthenticated calls", async () => {
    openUrl.mockClear();
    expect((await post("/api/sessions/not-a-session/resume")).status).toBe(404);
    const unauthenticated = await runtime.app.request(`${BASE}/api/sessions/${SESSION_A}/resume`, { method: "POST" });
    expect(unauthenticated.status).toBe(403);
    const hookOnly = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await mkdir(path.join(stateDir), { recursive: true });
    await appendFile(
      path.join(stateDir, "doc-sessions.jsonl"),
      `${JSON.stringify({ sessionId: hookOnly, filePath: path.join(await realpath(runtime.store.docsRoot), RATE_LIMITER), cwd: "/gone/away", at: new Date().toISOString() })}\n`,
    );
    await runtime.sessions.readHookLogs();
    const gone = await post(`/api/sessions/${hookOnly}/resume`);
    expect(await json<SessionActionResponse>(gone)).toMatchObject({ status: "unavailable" });
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("reviews API", () => {
  const DOC = "acme-api/2026-10-01-rate-limiter-plan.md";
  let runtime: Runtime;
  let docsRoot: string;
  const events: HubEvent[] = [];
  const auth = { origin: ORIGIN, [TOKEN_HEADER]: "" };

  const call = (url: string, body: unknown, headers: Record<string, string> = auth) =>
    runtime.app.request(`${BASE}${url}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    });

  beforeAll(async () => {
    docsRoot = await copyFixtureDocs();
    runtime = await createRuntime({ config: testConfig({ docsRoot }), webDist: null });
    auth[TOKEN_HEADER] = runtime.token;
    runtime.hub.subscribe((event) => events.push(event));
  });

  it("serves the doc hash alongside the raw markdown and an empty review", async () => {
    const doc = await json<DocDetail>(await runtime.app.request(`${BASE}/api/doc?path=${DOC}`));
    const review = await json<ReviewView>(await runtime.app.request(`${BASE}/api/review?path=${DOC}`));
    expect(review).toMatchObject({ doc: DOC, version: 0, threads: [], docHash: doc.hash, userName: "Test Reviewer" });
    expect((await runtime.app.request(`${BASE}/api/review?path=acme-api/missing.md`)).status).toBe(404);
  });

  it("guards review mutations with the origin and token checks", async () => {
    const response = await call("/api/review/submit", { path: DOC, version: 0, verdict: "comment", body: "" }, {});
    expect(response.status).toBe(403);
  });

  it("creates threads, rejects stale versions with 409 and publishes review changes from the watcher", async () => {
    const watcher = runtime.startWatching();
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const doc = await json<DocDetail>(await runtime.app.request(`${BASE}/api/doc?path=${DOC}`));
      const start = doc.raw.indexOf("token bucket");
      const created = await call("/api/review/threads", {
        path: DOC,
        version: 0,
        docHash: doc.hash,
        start,
        end: start + "token bucket".length,
        kind: "comment",
        body: "Why not a sliding window?",
        suggestion: null,
      });
      expect(created.status).toBe(200);
      const view = await json<ReviewView>(created);
      expect(view.threads[0]?.anchor.quote).toBe("token bucket");

      const stale = await call("/api/review/submit", { path: DOC, version: 0, verdict: "comment", body: "" });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ error: "conflict" });

      await expect
        .poll(() => events.some((event) => event.type === "review-changed" && event.path === DOC), { timeout: 3000 })
        .toBe(true);
      expect(events.some((event) => event.type === "doc-changed" && event.path.includes(".timthink"))).toBe(false);
    } finally {
      watcher.close();
    }
  });

  it("validates bodies and rejects paths outside docsRoot", async () => {
    expect((await call("/api/review/submit", { path: DOC, version: 1, verdict: "maybe", body: "" })).status).toBe(400);
    const outside = await call("/api/review/submit", { path: "../x.md", version: 0, verdict: "comment", body: "" });
    expect(outside.status).toBe(404);
  });
});
