import { appendFile, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { DocHistory } from "../history/routes.js";
import { TOKEN_HEADER } from "../security.js";
import { createRuntime, type Runtime } from "../server.js";
import { copyFixtureDocs, makeTempDir, testConfig } from "../test/fixtures.js";
import type { InboxResponse } from "./types.js";

const BASE = "http://127.0.0.1:7420";
const DOC = "acme-api/2026-10-01-rate-limiter-plan.md";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";

describe("history, seen and inbox API", () => {
  let runtime: Runtime;
  let docsRoot: string;
  let stateDir: string;

  const get = async <T>(url: string): Promise<T> => (await runtime.app.request(`${BASE}${url}`)).json() as Promise<T>;
  const post = (url: string, body: unknown) =>
    runtime.app.request(`${BASE}${url}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: BASE, [TOKEN_HEADER]: runtime.token },
    });
  const reasons = async () =>
    (await get<InboxResponse>("/api/inbox")).items.map((item) => `${item.reason} ${item.doc.path}`);

  beforeAll(async () => {
    docsRoot = await copyFixtureDocs();
    stateDir = await makeTempDir("timthink-state-");
    runtime = await createRuntime({ config: testConfig({ docsRoot, stateDir }), webDist: null });
    await runtime.startHistory();
  });

  it("starts with everything seen, so only standing items show", async () => {
    expect(await reasons()).toEqual([`review-requested ${DOC}`, `open-question ${DOC}`]);
    const seen = JSON.parse(await readFile(path.join(stateDir, "seen.json"), "utf8"));
    expect(Object.keys(seen.docs)).toContain(DOC);
  });

  it("snapshots a Claude edit, attributes it from the hook log and lists it as changed", async () => {
    const absolute = path.join(await realpath(docsRoot), DOC);
    const raw = await readFile(absolute, "utf8");
    await writeFile(absolute, raw.replace("## ", "## Rollout\n\nShip it behind a flag.\n\n## "));
    await appendFile(
      path.join(stateDir, "doc-sessions.jsonl"),
      `${JSON.stringify({ sessionId: SESSION_ID, filePath: absolute, cwd: null, at: new Date().toISOString() })}\n`,
    );
    await runtime.sessions.readHookLogs();
    await runtime.store.applyChanges([DOC]);
    await runtime.history.snapshotNow(DOC);

    const history = await get<DocHistory>(`/api/history?path=${encodeURIComponent(DOC)}`);
    expect(history.snapshots).toHaveLength(2);
    expect(history.snapshots[0]?.attribution).toMatchObject({ kind: "claude", sessionId: SESSION_ID });
    expect(history.seen?.hash).not.toBe(history.hash);
    const inbox = await get<InboxResponse>("/api/inbox");
    expect(inbox.items.find((item) => item.reason === "edited")?.attribution).toMatchObject({ kind: "claude" });

    const older = history.snapshots[1];
    const snapshot = await get<{ raw: string }>(
      `/api/history/snapshot?path=${encodeURIComponent(DOC)}&id=${encodeURIComponent(older?.id ?? "")}`,
    );
    expect(snapshot.raw).toBe(raw);
  });

  it("marks a doc seen and unseen", async () => {
    const { hash } = await get<DocHistory>(`/api/history?path=${encodeURIComponent(DOC)}`);
    expect((await post("/api/seen", { path: DOC, hash })).status).toBe(200);
    expect(await reasons()).not.toContain(`edited ${DOC}`);
    expect((await post("/api/seen/unseen", { path: DOC })).status).toBe(200);
    expect(await reasons()).toContain(`edited ${DOC}`);
    await post("/api/seen", { path: DOC, hash });
  });

  it("attributes the hub's own writes to you and keeps them out of the inbox", async () => {
    const view = await runtime.reviews.state(DOC);
    await runtime.reviews.submit(DOC, view.version, "approve", "Looks good");
    await runtime.store.applyChanges([DOC]);
    await runtime.history.snapshotNow(DOC);
    const history = await get<DocHistory>(`/api/history?path=${encodeURIComponent(DOC)}`);
    expect(history.snapshots[0]?.attribution).toEqual({ kind: "human", name: "Test Reviewer" });
    expect(history.seen?.hash).toBe(history.hash);
    expect(await reasons()).toEqual([`open-question ${DOC}`, `waiting-on-claude ${DOC}`]);
  });
});
