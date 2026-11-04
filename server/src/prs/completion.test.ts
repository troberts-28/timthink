import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DocSummary } from "../docs/types.js";
import type { HubDocWrite } from "../reviews/reviewService.js";
import { makeTempDir } from "../test/fixtures.js";
import { completePlansWithMergedPrs, openTasksNotCovered } from "./completion.js";

async function setup(status: string, marker: string | null, readOnly = false, body = "# Plan\n") {
  const docsRoot = await makeTempDir("timthink-complete-");
  await mkdir(path.join(docsRoot, "api"));
  const file = path.join(docsRoot, "api", "plan.md");
  await writeFile(file, `---\ntitle: Plan\nstatus: ${status} # keep\n---\n${body}`);
  const doc = { path: "api/plan.md", status } as DocSummary;
  const writes: HubDocWrite[] = [];
  const marked: string[] = [];
  const awaiting: string[] = [];
  await completePlansWithMergedPrs(["api/plan.md"], {
    docsRoot,
    readOnly,
    docs: { getDoc: () => doc },
    prs: {
      completionMarker: () => marker,
      markCompleted: async (docPath, value) => {
        marked.push(`${docPath}=${value}`);
      },
      markAwaiting: async (docPath, value, openTasks) => {
        awaiting.push(`${docPath}=${value}:${openTasks}`);
      },
    },
    onDocWrite: (write) => writes.push(write),
  });
  return { text: await readFile(file, "utf8"), writes, marked, awaiting };
}

describe("completePlansWithMergedPrs", () => {
  it("sets status: done once every PR merged, attributed to timthink", async () => {
    const { text, writes, marked } = await setup("in-progress", "12,13");
    expect(text).toContain("status: done # keep");
    expect(writes.map((write) => write.actorName)).toEqual(["timthink:all PRs merged"]);
    expect(marked).toEqual(["api/plan.md=12,13"]);
  });

  it("leaves finished plans, unmerged plans and read-only hubs alone", async () => {
    expect((await setup("abandoned", "12")).text).toContain("status: abandoned");
    expect((await setup("in-progress", null)).text).toContain("status: in-progress");
    const readOnly = await setup("in-progress", "12", true);
    expect(readOnly.text).toContain("status: in-progress");
    expect(readOnly.marked).toEqual([]);
  });

  it("holds off while tasks are open, counting tasks that name a merged PR as covered", async () => {
    const body = [
      "- [x] Phase 1 (#12)",
      "- [ ] Phase 2 (#13)",
      "- [ ] Phase 3: not started",
      "```",
      "- [ ] example in a fence",
      "```",
    ].join("\n");
    const held = await setup("in-progress", "12,13", false, body);
    expect(held.text).toContain("status: in-progress");
    expect(held.awaiting).toEqual(["api/plan.md=12,13:1"]);
    expect(held.marked).toEqual([]);
  });
});

describe("openTasksNotCovered", () => {
  it("treats PR links and URLs to merged PRs as covering a task", () => {
    const body = [
      "- [ ] Ship it (https://github.com/acme/api/pull/12)",
      "- [ ] Stack top (https://app.graphite.com/github/pr/acme/api/13)",
      "- [ ] Unrelated (#99)",
    ].join("\n");
    expect(openTasksNotCovered(body, new Set([12, 13]))).toBe(1);
  });
});
