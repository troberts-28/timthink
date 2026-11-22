import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { RoundView } from "../rounds/roundView.js";
import type { DocMovesRound, RoundInput } from "../rounds/schema.js";
import { TOKEN_HEADER } from "../security.js";
import { createRuntime, type Runtime } from "../server.js";
import { copyFixtureDocs, makeTempDir, testConfig } from "../test/fixtures.js";

const BASE = "http://127.0.0.1:7420";
const LIMITER = "acme-api/2026-10-01-rate-limiter-plan.md";
const LIMITER_MOVED = "platform/rate-limits/2026-10-01-rate-limiter-plan.md";
const WATERING = "garden-app/plans/2026-07-04-watering-schedule-plan.md";
const WATERING_MOVED = "payments/checkout-v2/2026-07-04-watering-schedule-plan.md";
const NOTES = "acme-api/2026-09-15-auth-refresh-notes.md";
const SCRATCH = "acme-api/untitled-scratch.md";

const MIGRATION: RoundInput = {
  kind: "doc-moves",
  title: "File every doc into a project",
  areas: [{ id: "platform", title: "Platform", summary: null }],
  projects: [
    { id: "platform/rate-limits", title: "Rate limits", summary: "Per-key limits.", repos: ["acme-api"], prs: [4211] },
  ],
  items: [
    {
      id: "1",
      doc: LIMITER,
      options: [{ id: "propose", label: "platform/rate-limits", target: "platform/rate-limits" }],
    },
    {
      id: "2",
      doc: WATERING,
      options: [{ id: "propose", label: "payments/checkout-v2", target: "payments/checkout-v2" }],
    },
    { id: "3", doc: SCRATCH, options: [{ id: "leave", label: "Leave it", target: null }] },
  ],
};

describe("doc-moves rounds", () => {
  let runtime: Runtime;
  let docsRoot: string;
  let round: DocMovesRound;

  const post = async (url: string, body: unknown) =>
    runtime.app.request(`${BASE}${url}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: BASE, [TOKEN_HEADER]: runtime.token },
    });
  const read = (relPath: string) => readFile(path.join(docsRoot, relPath), "utf8");

  beforeAll(async () => {
    docsRoot = await copyFixtureDocs();
    await writeFile(
      path.join(docsRoot, NOTES),
      `${await read(NOTES)}\nSee [the limiter](2026-10-01-rate-limiter-plan.md#rollout).\n`,
    );
    runtime = await createRuntime({
      config: testConfig({ docsRoot, stateDir: await makeTempDir("timthink-state-") }),
      webDist: null,
    });
    const created = await runtime.rounds.create({
      input: MIGRATION,
      repo: "timthink",
      project: null,
      cwd: null,
      now: new Date().toISOString(),
    });
    if (created.kind !== "doc-moves") {
      throw new Error("expected a doc-moves round");
    }
    round = created;
  });

  it("moves docs with their state and links on submit, and undo puts every file back", async () => {
    const before = await snapshotTree(docsRoot);
    const raw = await read(LIMITER);
    const quote = "# Rate limiter for the public API";
    const { version, docHash } = await runtime.reviews.state(LIMITER);
    const start = raw.indexOf(quote);
    await runtime.reviews.createThread(LIMITER, {
      version,
      docHash,
      start,
      end: start + quote.length,
      kind: "comment",
      body: "Per key or per account?",
      suggestion: null,
    });
    await runtime.seen.markSeen(LIMITER, docHash);
    const withReview = await snapshotTree(docsRoot);

    expect((await post("/api/round/decision", other(round.id, "2", "elsewhere/a/b"))).status).toBe(422);
    expect((await post("/api/round/decisions", { id: round.id, decisions: proposals("1", "2") })).status).toBe(200);
    expect((await post("/api/round/decision", leave(round.id, "3"))).status).toBe(200);
    const submitted: RoundView = await (await post("/api/round/submit", { id: round.id })).json();

    expect(submitted.round.state).toBe("done");
    expect(submitted.canUndo).toBe(true);
    expect(submitted.round.outcomes).toEqual({
      "1": { kind: "moved", note: LIMITER_MOVED, commit: null },
      "2": { kind: "moved", note: WATERING_MOVED, commit: null },
      "3": { kind: "skipped", note: "Left in place", commit: null },
    });
    expect(await read("platform/rate-limits/project.yaml")).toContain("acme-api#4211");
    expect(await read("platform/rate-limits/2026-10-01-rate-limiter-demo.html")).toContain("<");
    expect(await read(NOTES)).toContain("](../platform/rate-limits/2026-10-01-rate-limiter-plan.md#rollout)");
    expect(await read(WATERING_MOVED)).toMatch(/^---\n[\s\S]*\nrepo: garden-app\n---\n/);
    expect(runtime.store.getDoc(WATERING_MOVED)?.codeRepo).toBe("garden-app");
    expect(runtime.store.getDoc(LIMITER_MOVED)?.projectId).toBe("platform/rate-limits");
    expect((await runtime.reviews.state(LIMITER_MOVED)).threads.map((thread) => thread.messages[0]?.body)).toEqual([
      "Per key or per account?",
    ]);
    expect(runtime.seen.get(LIMITER_MOVED)?.hash).toBe(docHash);
    const moved = await runtime.app.request(`${BASE}/api/doc?path=${encodeURIComponent(LIMITER)}`);
    expect([moved.status, await moved.json()]).toEqual([404, { error: "Moved", movedTo: LIMITER_MOVED }]);

    const undone: RoundView = await (await post("/api/round/undo", { id: round.id })).json();
    expect([undone.round.state, undone.round.outcomes, undone.canUndo]).toEqual(["open", {}, false]);
    expect(Object.keys(undone.round.decisions)).toEqual(["1", "2", "3"]);
    expect(await snapshotTree(docsRoot)).toEqual(withReview);
    expect(Object.keys(withReview).filter((file) => !(file in before))).toEqual([
      "acme-api/.timthink/reviews/2026-10-01-rate-limiter-plan.md.json",
    ]);
    expect(runtime.seen.get(LIMITER)?.hash).toBe(docHash);
    expect(runtime.store.getDoc(LIMITER)?.projectId).toBeNull();
  });
});

function other(id: string, itemId: string, text: string) {
  return { id, itemId, decision: { choice: { kind: "other", text }, reply: "" } };
}

function leave(id: string, itemId: string) {
  return { id, itemId, decision: { choice: { kind: "option", optionId: "leave" }, reply: "" } };
}

function proposals(...itemIds: string[]) {
  return Object.fromEntries(
    itemIds.map((itemId) => [itemId, { choice: { kind: "option", optionId: "propose" }, reply: "" }]),
  );
}

async function snapshotTree(root: string) {
  const files: Record<string, string> = {};
  const walk = async (relDir: string) => {
    for (const entry of await readdir(path.join(root, relDir), { withFileTypes: true })) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(relPath);
      } else if (!entry.name.endsWith(".lock")) {
        files[relPath] = await readFile(path.join(root, relPath), "utf8");
      }
    }
  };
  await walk("");
  return files;
}
