import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { copyClaudeProjects, makeTempDir } from "../test/fixtures.js";
import {
  BACKFILL_CACHE_FILE,
  docPathsMentioned,
  lastStringField,
  rootSpellings,
  scanTranscript,
  TranscriptBackfill,
} from "./transcripts.js";

const DOCS_ROOT = "/fixture/agent-docs";
const CODE_ROOT = "/fixture/code";
const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const SESSION_C = "33333333-3333-4333-8333-333333333333";

describe("lastStringField", () => {
  it("reads the last top-level occurrence and unescapes it", () => {
    const line = '{"input":{"cwd":"/nested"},"cwd":"/top \\"level\\"","timestamp":"2026-01-01T00:00:00Z"}';
    expect(lastStringField(line, "cwd")).toBe('/top "level"');
    expect(lastStringField(line, "timestamp")).toBe("2026-01-01T00:00:00Z");
    expect(lastStringField(line, "gitBranch")).toBeNull();
  });
});

describe("docPathsMentioned", () => {
  const spellings = rootSpellings(["/Users/me/docs"], "/Users/me");

  it("finds absolute and ~ plan paths inside commands", () => {
    expect(
      docPathsMentioned(
        "sed -n 1,40p /Users/me/docs/acme/a-plan.md && timthink review show ~/docs/acme/sub/b.md; cat '/Users/me/docs/acme/c.md'",
        spellings,
      ),
    ).toEqual(["/Users/me/docs/acme/a-plan.md", "/Users/me/docs/acme/c.md", "/Users/me/docs/acme/sub/b.md"]);
  });

  it("ignores non-markdown files, other roots and trailing punctuation", () => {
    expect(
      docPathsMentioned("see /Users/me/docs/acme/plan.md, /Users/me/docs/acme/data.tsv and /tmp/x.md", spellings),
    ).toEqual(["/Users/me/docs/acme/plan.md"]);
  });
});

describe("scanTranscript", () => {
  let projectsDir: string;

  beforeEach(async () => {
    projectsDir = await copyClaudeProjects({ docsRoot: DOCS_ROOT, codeRoot: CODE_ROOT });
  });

  it("collects title, cwd, branch, timestamps and plan writes", async () => {
    const summary = await scanTranscript(path.join(projectsDir, "-code-acme-api", `${SESSION_A}.jsonl`), [DOCS_ROOT]);
    expect(summary).toEqual({
      sessionId: SESSION_A,
      transcriptPath: path.join(projectsDir, "-code-acme-api", `${SESSION_A}.jsonl`),
      cwd: `${CODE_ROOT}/acme-api`,
      gitBranch: "feat/rate-limiter",
      firstSeen: "2026-10-01T09:00:00.000Z",
      lastActivity: "2026-10-01T10:30:00.000Z",
      title: "Rate limiter plan",
      firstPrompt: "Plan a token-bucket rate limiter for the public API.",
      docTouches: [
        {
          filePath: `${DOCS_ROOT}/acme-api/2026-10-01-rate-limiter-plan.md`,
          at: "2026-10-01T10:30:00.000Z",
          firstAt: "2026-10-01T09:02:00.000Z",
          kind: "write",
        },
      ],
      buildRequests: [],
      submittedPrs: [],
    });
  });

  it("skips meta prompts and records every file of a multi-tool message", async () => {
    const summary = await scanTranscript(path.join(projectsDir, "-code-acme-api-2", `${SESSION_B}.jsonl`), [DOCS_ROOT]);
    expect(summary?.title).toBeNull();
    expect(summary?.firstPrompt).toBe("Draft the billing migration plan and list open questions");
    expect(summary?.docTouches.map((write) => write.filePath)).toEqual([
      `${DOCS_ROOT}/acme-api/billing-migration/2026-10-20-billing-migration-plan.md`,
      `${DOCS_ROOT}/acme-api/billing-migration/notes/2026-10-21-open-questions.md`,
    ]);
  });

  it("ignores writes outside the docs roots", async () => {
    const summary = await scanTranscript(path.join(projectsDir, "-code-acme-api", `${SESSION_A}.jsonl`), [
      "/other/docs",
    ]);
    expect(summary?.docTouches).toEqual([]);
  });
});

describe("TranscriptBackfill", () => {
  it("scans every session file once and reuses the cache after a restart", async () => {
    const projectsDir = await copyClaudeProjects({ docsRoot: DOCS_ROOT, codeRoot: CODE_ROOT });
    const cachePath = path.join(await makeTempDir(), BACKFILL_CACHE_FILE);
    const seen: string[] = [];
    const first = await new TranscriptBackfill(projectsDir, [DOCS_ROOT], cachePath).run((summary) =>
      seen.push(summary.sessionId),
    );
    expect(first).toMatchObject({ files: 3, scanned: 3, cached: 0 });
    expect(seen.sort()).toEqual([SESSION_A, SESSION_B, SESSION_C]);
    expect(JSON.parse(await readFile(cachePath, "utf8"))).toHaveProperty("entries");

    const restarted = new TranscriptBackfill(projectsDir, [DOCS_ROOT], cachePath);
    const reseen: string[] = [];
    expect(await restarted.run((summary) => reseen.push(summary.sessionId))).toMatchObject({ scanned: 0, cached: 3 });
    expect(reseen).toHaveLength(3);

    await appendFile(
      path.join(projectsDir, "-code-garden-app", `${SESSION_C}.jsonl`),
      '{"type":"ai-title","aiTitle":"Sensor fix","sessionId":"33333333-3333-4333-8333-333333333333"}\n',
    );
    const titles = new Map<string, string | null>();
    expect(await restarted.run((summary) => titles.set(summary.sessionId, summary.title))).toMatchObject({
      scanned: 1,
    });
    expect(titles.get(SESSION_C)).toBe("Sensor fix");

    const otherRoots = new TranscriptBackfill(projectsDir, ["/elsewhere"], cachePath);
    expect(await otherRoots.run()).toMatchObject({ scanned: 3 });
  });
});
