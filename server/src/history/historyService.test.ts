import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DocsStore } from "../docs/store.js";
import type { SessionRecord } from "../sessions/sessionStore.js";
import { makeTempDir } from "../test/fixtures.js";
import { HistoryService, type WriterLookup } from "./historyService.js";

const DOC = "acme/2026-11-02-plan.md";

function session(id: string, title: string): SessionRecord {
  return {
    id,
    title,
    cwd: null,
    branch: null,
    firstSeen: null,
    lastActivity: null,
    live: false,
    livenessKnown: false,
    warpFocusUrl: null,
    transcriptPath: null,
    docPaths: [DOC],
    writtenDocPaths: [DOC],
    plannedDocPaths: [DOC],
    builtDocPaths: [],
    submittedPrs: [],
    docEvents: [],
  };
}

function writers(entries: { docPath: string; at: Date; session: SessionRecord }[]): WriterLookup {
  return {
    writerNear: (docPath, atMs, windowMs) =>
      entries.find((entry) => entry.docPath === docPath && Math.abs(entry.at.getTime() - atMs) <= windowMs)?.session ??
      null,
  };
}

async function setup(lookup: WriterLookup = writers([])) {
  const root = await makeTempDir();
  await mkdir(path.join(root, "acme"), { recursive: true });
  const store = new DocsStore(root);
  const snapshots: string[] = [];
  const history = new HistoryService({
    docsRoot: root,
    store,
    sessions: lookup,
    keepHashes: () => new Set(),
    onSnapshot: (docPath) => snapshots.push(docPath),
    debounceMs: 20,
  });
  const write = async (text: string, mtime: Date) => {
    const file = path.join(root, DOC);
    await writeFile(file, text);
    await utimes(file, mtime, mtime);
    await store.applyChanges([DOC]);
  };
  return { root, store, history, snapshots, write };
}

describe("HistoryService", () => {
  it("attributes a change to the Claude session whose hook write landed within 10s", async () => {
    const changedAt = new Date(Date.UTC(2026, 10, 2, 10, 0, 0));
    const claude = session("11111111-1111-4111-8111-111111111111", "Plan the feed");
    const { history, write } = await setup(
      writers([{ docPath: DOC, at: new Date(changedAt.getTime() + 4_000), session: claude }]),
    );
    await write("# Plan\n\nFirst\n", new Date(changedAt.getTime() - 60_000));
    await history.snapshotNow(DOC);
    await write("# Plan\n\nSecond\n", changedAt);
    await history.snapshotNow(DOC);
    const [latest, first] = await history.list(DOC);
    expect(latest?.attribution).toEqual({ kind: "claude", sessionId: claude.id, sessionTitle: "Plan the feed" });
    expect(first?.attribution).toEqual({ kind: "unknown" });
  });

  it("attributes the hub's own writes to the human", async () => {
    const { history, write } = await setup();
    history.recordHubWrite(DOC, "accepted\n", "Sam");
    await write("accepted\n", new Date());
    await history.snapshotNow(DOC);
    const [latest] = await history.list(DOC);
    expect(latest?.attribution).toEqual({ kind: "human", name: "Sam" });
  });

  it("debounces bursts of changes into one snapshot", async () => {
    const { history, write, snapshots } = await setup();
    await write("one\n", new Date());
    history.schedule([DOC]);
    await write("two\n", new Date());
    history.schedule([DOC]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(snapshots).toEqual([DOC]);
    expect(await history.list(DOC)).toHaveLength(1);
  });

  it("snapshots hundreds of existing docs quickly and only once", async () => {
    const root = await makeTempDir();
    const docCount = 300;
    for (let index = 0; index < docCount; index += 1) {
      const dir = path.join(root, `repo-${index % 10}`);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, `2026-10-${String((index % 28) + 1).padStart(2, "0")}-plan-${index}.md`),
        `# Plan ${index}\n`,
      );
    }
    const store = new DocsStore(root);
    await store.scanAll();
    const history = new HistoryService({ docsRoot: root, store, sessions: writers([]), keepHashes: () => new Set() });
    const first = await history.snapshotAll();
    expect(first.saved).toBe(docCount);
    expect(first.durationMs).toBeLessThan(5_000);
    const second = await history.snapshotAll();
    expect(second.saved).toBe(0);
    expect(await readdir(path.join(root, "repo-0", ".timthink", "history"))).toHaveLength(30);
  });
});
