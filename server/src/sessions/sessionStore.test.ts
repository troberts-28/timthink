import { appendFile, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { copyClaudeProjects, copyFixtureDocs, makeTempDir } from "../test/fixtures.js";
import { DOC_SESSIONS_LOG, SESSIONS_LOG } from "./hookLog.js";
import { type SessionChange, SessionStore } from "./sessionStore.js";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const SESSION_E = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PANE_1 = "warp://session/11111111111111111111111111111111";
const PANE_2 = "warp://session/22222222222222222222222222222222";
const RATE_LIMITER = "acme-api/2026-10-01-rate-limiter-plan.md";
const BILLING = "acme-api/billing-migration/2026-10-20-billing-migration-plan.md";

interface StartRecord {
  sessionId: string;
  at: string;
  warpFocusUrl?: string;
  cwd?: string;
}

describe("SessionStore", () => {
  let docsRoot: string;
  let stateDir: string;
  let store: SessionStore;
  let changes: SessionChange[];

  const appendLines = (file: string, records: readonly object[]) =>
    appendFile(path.join(stateDir, file), records.map((record) => `${JSON.stringify(record)}\n`).join(""));

  const start = ({ sessionId, at, warpFocusUrl, cwd = "/code/acme-api" }: StartRecord) =>
    appendLines(SESSIONS_LOG, [
      { v: 1, event: "SessionStart", sessionId, at, cwd, source: "startup", warpFocusUrl, gitBranch: "main" },
    ]);

  const end = (sessionId: string, at: string) =>
    appendLines(SESSIONS_LOG, [{ v: 1, event: "SessionEnd", sessionId, at, reason: "prompt_input_exit" }]);

  beforeEach(async () => {
    docsRoot = await copyFixtureDocs();
    stateDir = await makeTempDir("timthink-state-");
    const claudeProjectsDir = await copyClaudeProjects({ docsRoot, codeRoot: "/code" });
    changes = [];
    store = new SessionStore({ docsRoot, stateDir, claudeProjectsDir, onChange: (change) => changes.push(change) });
    await store.init();
  });

  it("links backfilled sessions to the plans they wrote", async () => {
    expect(store.scanning).toBe(true);
    await store.runBackfill();
    expect(store.scanning).toBe(false);
    expect(store.forDoc(RATE_LIMITER)).toMatchObject([
      {
        id: SESSION_A,
        title: "Rate limiter plan",
        cwd: "/code/acme-api",
        branch: "feat/rate-limiter",
        firstSeen: "2026-10-01T09:00:00.000Z",
        lastActivity: "2026-10-01T10:30:00.000Z",
        live: false,
        warpFocusUrl: null,
      },
    ]);
    expect(store.forDoc(BILLING)).toMatchObject([
      { id: SESSION_B, title: "Draft the billing migration plan and list open questions" },
    ]);
    expect(store.forDoc("garden-app/plans/2026-07-04-watering-schedule-plan.md")).toEqual([]);
  });

  it("tracks liveness and the newest focus URL from hook records", async () => {
    await store.runBackfill();
    await start({ sessionId: SESSION_A, at: "2026-11-01T09:00:00.000Z", warpFocusUrl: PANE_1 });
    await store.readHookLogs();
    expect(store.get(SESSION_A)).toMatchObject({ live: true, warpFocusUrl: PANE_1 });

    await end(SESSION_A, "2026-11-01T10:00:00.000Z");
    await store.readHookLogs();
    expect(store.get(SESSION_A)).toMatchObject({ live: false, lastActivity: "2026-11-01T10:00:00.000Z" });

    await start({ sessionId: SESSION_A, at: "2026-11-01T11:00:00.000Z", warpFocusUrl: PANE_2 });
    await store.readHookLogs();
    expect(store.get(SESSION_A)).toMatchObject({ live: true, warpFocusUrl: PANE_2 });
    expect(changes.at(-1)).toEqual({ sessionIds: [SESSION_A], docPaths: [RATE_LIMITER] });
  });

  it("prefers running processes over hook records for liveness and the focus URL", async () => {
    await store.runBackfill();
    await start({ sessionId: SESSION_B, at: "2026-11-01T09:00:00.000Z", warpFocusUrl: PANE_1 });
    await store.readHookLogs();
    expect(store.get(SESSION_A)).toMatchObject({ live: false, livenessKnown: false, warpFocusUrl: null });

    store.applyLiveProcesses([
      { pid: 7, sessionId: SESSION_A, updatedAt: 1, warpFocusUrl: PANE_2 },
      { pid: 8, sessionId: SESSION_A, updatedAt: 2, warpFocusUrl: PANE_1 },
    ]);
    expect(store.get(SESSION_A)).toMatchObject({ live: true, livenessKnown: true, warpFocusUrl: PANE_1 });
    expect(store.get(SESSION_B)?.live).toBe(false);
    expect(changes.at(-1)).toEqual({ sessionIds: [SESSION_A], docPaths: [RATE_LIMITER] });

    store.applyLiveProcesses(null);
    expect(store.get(SESSION_B)?.live).toBe(true);
  });

  it("treats a session as ended once another session starts in its pane", async () => {
    await start({ sessionId: SESSION_A, at: "2026-11-01T09:00:00.000Z", warpFocusUrl: PANE_1 });
    await start({ sessionId: SESSION_B, at: "2026-11-01T09:30:00.000Z", warpFocusUrl: PANE_1 });
    await store.readHookLogs();
    expect(store.get(SESSION_A)?.live).toBe(false);
    expect(store.get(SESSION_B)?.live).toBe(true);
  });

  it("links plans written by hook-only sessions and ignores files outside the docs root", async () => {
    await appendLines(DOC_SESSIONS_LOG, [
      {
        v: 1,
        sessionId: SESSION_E,
        filePath: path.join(await realpath(docsRoot), BILLING),
        tool: "Edit",
        cwd: "/code/acme-api-3",
        at: "2026-11-02T08:00:00.000Z",
      },
      { v: 1, sessionId: SESSION_E, filePath: "/etc/hosts", tool: "Edit", at: "2026-11-02T08:01:00.000Z" },
      { broken: true },
    ]);
    await appendFile(path.join(stateDir, DOC_SESSIONS_LOG), "not json\n");
    await store.readHookLogs();
    expect(store.forDoc(BILLING).map((session) => [session.id, session.title, session.cwd])).toEqual([
      [SESSION_E, "Session eeeeeeee", "/code/acme-api-3"],
    ]);
    expect(changes).toEqual([{ sessionIds: [SESSION_E], docPaths: [BILLING] }]);
  });

  it("reads only appended lines and starts over when a log is truncated", async () => {
    await start({ sessionId: SESSION_A, at: "2026-11-01T09:00:00.000Z", warpFocusUrl: PANE_1 });
    await store.readHookLogs();
    expect((await store.readHookLogs()).sessionIds).toEqual([]);
    await writeFile(path.join(stateDir, SESSIONS_LOG), "");
    await store.readHookLogs();
    expect(store.get(SESSION_A)?.live).toBe(false);
  });

  it("maps paths through a symlinked docs root", async () => {
    const linkParent = await makeTempDir();
    const linkedRoot = path.join(linkParent, "docs-link");
    await symlink(docsRoot, linkedRoot);
    await mkdir(path.join(stateDir, "linked"), { recursive: true });
    const linked = new SessionStore({
      docsRoot: linkedRoot,
      stateDir: path.join(stateDir, "linked"),
      claudeProjectsDir: "/nonexistent",
    });
    await linked.init();
    expect(linked.docPathFor(path.join(await realpath(docsRoot), RATE_LIMITER))).toBe(RATE_LIMITER);
    expect(linked.docPathFor(path.join(linkedRoot, RATE_LIMITER))).toBe(RATE_LIMITER);
    expect(linked.docPathFor("/etc/hosts")).toBeNull();
  });
});
