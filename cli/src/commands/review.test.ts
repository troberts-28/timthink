import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReviewService } from "@timthink/server";
import { beforeEach, describe, expect, it } from "vitest";
import { NOTHING_TO_ADDRESS_EXIT_CODE, type ReviewIo, resolveDocArgument, runReview } from "./review.js";

const DOC = "acme/2026-11-02-feed-plan.md";
const PLAN = `---
title: Feed
status: review
---

# Feed

## TL;DR

Start writing to it early, without a gate, so history has depth.

## Rollout

Ship the table first.
Then backfill.

\`\`\`question id=gate
Gate the writes?
- Behind a flag
- Dark-write from day one
\`\`\`
`;

interface Captured {
  io: ReviewIo;
  out: string[];
  err: string[];
}

function captureIo(stdin = ""): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (text) => out.push(text),
      err: (text) => err.push(text),
      readStdin: async () => stdin,
      stdinIsTty: stdin === "",
    },
  };
}

let docsRoot: string;
let human: ReviewService;
const config = () => ({ docsRoot, userName: "Test Reviewer" });

async function cli(args: string[], options = {}, stdin = ""): Promise<{ code: number; out: string; err: string }> {
  const captured = captureIo(stdin);
  const code = await runReview(config(), args, options, captured.io);
  return { code, out: captured.out.join("\n"), err: captured.err.join("\n") };
}

function rangeOf(quote: string): { start: number; end: number } {
  const start = PLAN.indexOf(quote);
  return { start, end: start + quote.length };
}

async function submitReview(): Promise<{ commentId: string; suggestionId: string }> {
  let view = await human.state(DOC);
  const base = { docHash: view.docHash, suggestion: null };
  view = await human.createThread(DOC, {
    ...base,
    version: view.version,
    ...rangeOf("early, without a gate"),
    kind: "comment",
    body: "Is skipping the gate safe?",
  });
  view = await human.createThread(DOC, {
    ...base,
    version: view.version,
    ...rangeOf("Ship the table first.\nThen backfill."),
    kind: "suggestion",
    body: "Order matters",
    suggestion: "Backfill first, then ship the table.",
  });
  view = await human.answer(DOC, view.version, {
    questionId: "gate",
    prompt: "Gate the writes?",
    choice: 1,
    choiceText: "Dark-write from day one",
    note: "but keep a kill switch",
  });
  await human.submit(DOC, view.version, "request_changes", "Close, a couple of things.");
  const [comment, suggestion] = (await human.state(DOC)).threads;
  return { commentId: comment?.id ?? "", suggestionId: suggestion?.id ?? "" };
}

beforeEach(async () => {
  docsRoot = path.join(await mkdtemp(path.join(tmpdir(), "timthink-cli-review-")), "docs");
  await mkdir(path.join(docsRoot, "acme"), { recursive: true });
  await writeFile(path.join(docsRoot, DOC), PLAN);
  human = new ReviewService({ docsRoot, userName: "Test Reviewer" });
});

describe("resolveDocArgument", () => {
  it("accepts absolute and docsRoot-relative paths", async () => {
    expect(await resolveDocArgument(docsRoot, path.join(docsRoot, DOC))).toBe(DOC);
    expect(await resolveDocArgument(docsRoot, DOC)).toBe(DOC);
    await expect(resolveDocArgument(docsRoot, "/elsewhere/plan.md")).rejects.toThrow(/not inside docsRoot/);
  });
});

describe("timthink review", () => {
  it("says there is nothing to address before a review is submitted", async () => {
    const result = await cli(["show", DOC]);
    expect(result.code).toBe(NOTHING_TO_ADDRESS_EXIT_CODE);
    expect(result.out).toContain("Nothing to address");
  });

  it("shows the submitted review as markdown for an agent", async () => {
    const { commentId, suggestionId } = await submitReview();
    const { code, out } = await cli(["show", path.join(docsRoot, DOC)]);
    expect(code).toBe(0);
    expect(out).toContain(`# Review of ${DOC}`);
    expect(out).toContain("## Verdict: Request changes");
    expect(out).toContain("> Close, a couple of things.");
    expect(out).toContain(`### Thread \`${commentId}\` · comment`);
    expect(out).toContain("Section: Feed › TL;DR\nLine 10:\n\n> early, without a gate");
    expect(out).toContain("**Test Reviewer:** Is skipping the gate safe?");
    expect(out).toContain(`### Thread \`${suggestionId}\` · suggestion`);
    expect(out).toContain("Lines 14–15:\n\n> Ship the table first.\n> Then backfill.");
    expect(out).toContain("```markdown\nBackfill first, then ship the table.\n```");
    expect(out).toContain("### Question `gate`\n\nQuestion: Gate the writes?\nChosen option: Dark-write from day one");
    expect(out).toContain("Note: but keep a kill switch");
  });

  it("replies, resolves, acknowledges answers and marks the review addressed", async () => {
    const { commentId, suggestionId } = await submitReview();
    expect((await cli(["reply", DOC, commentId, "Added", "a", "gate"])).code).toBe(0);
    expect((await cli(["reply", DOC, suggestionId, "-"], {}, "Declined: the table must exist first.\n")).code).toBe(0);
    expect((await cli(["resolve", DOC, commentId.replace(/^t-/, "")], { message: "Done" })).code).toBe(0);
    expect((await cli(["answer-ack", DOC, "gate"], { message: "Dark-writes it is" })).code).toBe(0);

    const view = await human.state(DOC);
    const comment = view.threads.find((thread) => thread.id === commentId);
    expect(comment?.status).toBe("resolved");
    expect(comment?.messages.map((message) => [message.author, message.body])).toEqual([
      ["human", "Is skipping the gate safe?"],
      ["claude", "Added a gate"],
      ["claude", "Done"],
    ]);
    expect(view.threads.find((thread) => thread.id === suggestionId)?.messages.at(-1)?.body).toBe(
      "Declined: the table must exist first.",
    );
    expect(view.answers[0]?.ack?.message).toBe("Dark-writes it is");

    const shown = await cli(["show", DOC]);
    expect(shown.out).not.toContain(commentId);
    expect(shown.out).toContain("**Claude (you):** Declined");
    expect(shown.out).not.toContain("### Question");

    const listed = await cli(["list"]);
    expect(listed.out).toMatch(new RegExp(`^${DOC}\\trequest changes\\tsubmitted \\d+m ago\\t1 open thread\\(s\\)$`));

    const addressed = await cli(["addressed", DOC]);
    expect(addressed.out).toContain("1 thread(s) left open");
    expect((await cli(["show", DOC])).code).toBe(NOTHING_TO_ADDRESS_EXIT_CODE);
    expect((await cli(["list"])).out).toBe("No submitted reviews are waiting.");
    expect((await cli(["addressed", DOC])).code).toBe(1);
  });

  it("reports unknown threads and usage errors without a stack trace", async () => {
    await submitReview();
    const unknown = await cli(["reply", DOC, "t-nope", "hi"]);
    expect(unknown).toMatchObject({ code: 1, err: "No thread with id t-nope" });
    expect((await cli(["reply", DOC, "t-nope"])).err).toContain("pipe it on stdin");
    expect((await cli(["bogus", DOC])).err).toContain("Unknown review command");
  });

  it("re-anchors quotes against the current plan before showing them", async () => {
    await submitReview();
    await writeFile(path.join(docsRoot, DOC), PLAN.replace("## TL;DR\n", "## TL;DR\n\nA new first paragraph.\n"));
    const { out } = await cli(["show", DOC]);
    expect(out).toContain("Line 12:\n\n> early, without a gate");
  });
});
