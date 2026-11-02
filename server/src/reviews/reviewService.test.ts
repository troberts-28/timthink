import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../test/fixtures.js";
import { CLAUDE_ACTOR, ReviewOperationError } from "./operations.js";
import { docHash, docPathForReviewFile, reviewFileFor, reviewSlug } from "./paths.js";
import { DocChangedError, ReviewService } from "./reviewService.js";
import { InvalidDocPathError, ReviewConflictError } from "./reviewStore.js";

const DOC = "acme/plans/2026-11-02-feed plan.md";
const PLAN = `---
title: Feed
status: review
---

# Feed

## TL;DR

Start writing to it early, without a gate, so history has depth.

## Rollout

Ship the table first.
`;

let docsRoot: string;
let service: ReviewService;

async function writeDoc(raw: string, docPath = DOC): Promise<void> {
  const absolute = path.join(docsRoot, docPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, raw);
}

function readDoc(docPath = DOC): Promise<string> {
  return readFile(path.join(docsRoot, docPath), "utf8");
}

function rangeOf(source: string, quote: string): { start: number; end: number } {
  const start = source.indexOf(quote);
  return { start, end: start + quote.length };
}

async function comment(quote: string, body = "Why no gate?") {
  const state = await service.state(DOC);
  const raw = await readDoc();
  return service.createThread(DOC, {
    version: state.version,
    docHash: state.docHash,
    ...rangeOf(raw, quote),
    kind: "comment",
    body,
    suggestion: null,
  });
}

beforeEach(async () => {
  docsRoot = await makeTempDir();
  await writeDoc(PLAN);
  let tick = 0;
  service = new ReviewService({
    docsRoot,
    userName: "Test Reviewer",
    now: () => new Date(Date.UTC(2026, 10, 2, 12, 0, tick++)).toISOString(),
  });
});

describe("review file paths", () => {
  it("encodes the repo-relative doc path into one reversible file name", () => {
    expect(reviewSlug("plans/2026-11-02-feed plan.md")).toBe("plans%2F2026-11-02-feed%20plan.md");
    const file = reviewFileFor(DOC);
    expect(file).toBe("acme/.timthink/reviews/plans%2F2026-11-02-feed%20plan.md.json");
    expect(file && docPathForReviewFile(file)).toBe(DOC);
    expect(docPathForReviewFile("acme/.timthink/reviews/x.json.lock")).toBeNull();
    expect(docPathForReviewFile("acme/plans/x.json")).toBeNull();
    expect(docPathForReviewFile("acme/.timthink/reviews/ignored.json")).toBeNull();
  });

  it("refuses doc paths that could escape docsRoot", async () => {
    await expect(service.state("../outside.md")).rejects.toThrow(InvalidDocPathError);
    await expect(service.state("acme/../../outside.md")).rejects.toThrow(InvalidDocPathError);
  });
});

describe("drafts and threads", () => {
  it("creates a draft review lazily and anchors the thread to the raw markdown", async () => {
    const view = await comment("early, without a gate");
    expect(view.version).toBe(1);
    expect(view.draftReviewId).toBe(view.reviews[0]?.id);
    const [thread] = view.threads;
    expect(thread?.anchor).toMatchObject({ quote: "early, without a gate", headingPath: ["Feed", "TL;DR"] });
    expect(thread?.messages[0]).toMatchObject({ author: "human", name: "Test Reviewer", body: "Why no gate?" });
    const stored = JSON.parse(await readFile(path.join(docsRoot, reviewFileFor(DOC) ?? ""), "utf8"));
    expect(stored.threads).toHaveLength(1);
  });

  it("rejects a thread made against an older version of the plan", async () => {
    const state = await service.state(DOC);
    await writeDoc(`${PLAN}\nMore.\n`);
    await expect(
      service.createThread(DOC, {
        version: state.version,
        docHash: state.docHash,
        ...rangeOf(PLAN, "Ship the table"),
        kind: "comment",
        body: "x",
        suggestion: null,
      }),
    ).rejects.toThrow(DocChangedError);
  });

  it("edits and deletes drafts, but not submitted threads", async () => {
    let view = await comment("Ship the table first.");
    const id = view.threads[0]?.id ?? "";
    view = await service.editThread(DOC, view.version, id, { body: "Edited", suggestion: null });
    expect(view.threads[0]?.messages[0]?.body).toBe("Edited");
    view = (await service.submit(DOC, view.version, "comment", "")).review;
    await expect(service.deleteThread(DOC, view.version, id)).rejects.toThrow(ReviewOperationError);
  });
});

describe("optimistic concurrency", () => {
  it("rejects a write based on a stale version", async () => {
    const view = await comment("Ship the table first.");
    const id = view.threads[0]?.id ?? "";
    await service.reply(DOC, view.version, id, "first");
    await expect(service.reply(DOC, view.version, id, "second")).rejects.toThrow(ReviewConflictError);
  });

  it("serialises concurrent unversioned writes from the CLI without losing any", async () => {
    const view = await comment("Ship the table first.");
    const id = view.threads[0]?.id ?? "";
    await Promise.all(
      Array.from({ length: 8 }, (_, index) => service.reply(DOC, null, id, `reply ${index}`, CLAUDE_ACTOR)),
    );
    const after = await service.state(DOC);
    expect(after.threads[0]?.messages.filter((message) => message.author === "claude")).toHaveLength(8);
    expect(after.version).toBe(view.version + 8);
  });
});

describe("accepting a suggestion", () => {
  async function suggest(quote: string, suggestion: string) {
    const state = await service.state(DOC);
    const raw = await readDoc();
    return service.createThread(DOC, {
      version: state.version,
      docHash: state.docHash,
      ...rangeOf(raw, quote),
      kind: "suggestion",
      body: "",
      suggestion,
    });
  }

  it("applies the replacement, resolves the thread and re-anchors to the new text", async () => {
    const view = await suggest("early, without a gate", "behind a feature flag");
    const id = view.threads[0]?.id ?? "";
    const accepted = await service.acceptSuggestion(DOC, view.version, id, view.docHash);
    const raw = await readDoc();
    expect(raw).toBe(PLAN.replace("early, without a gate", "behind a feature flag"));
    expect(accepted.docHash).toBe(docHash(raw));
    const thread = accepted.threads[0];
    expect(thread).toMatchObject({ status: "resolved", resolvedBy: "human" });
    expect(thread?.anchor.quote).toBe("behind a feature flag");
    expect(thread?.messages.at(-1)?.body).toBe("Accepted");
  });

  it("refuses when the plan changed since the client loaded it, leaving the file alone", async () => {
    const view = await suggest("early, without a gate", "behind a flag");
    const edited = PLAN.replace("Ship the table first.", "Ship the table second.");
    await writeDoc(edited);
    const id = view.threads[0]?.id ?? "";
    await expect(service.acceptSuggestion(DOC, view.version, id, view.docHash)).rejects.toThrow(DocChangedError);
    expect(await readDoc()).toBe(edited);
  });

  it("refuses when the suggested passage was deleted", async () => {
    const view = await suggest("Ship the table first.", "Ship the API first.");
    const edited = PLAN.replace("Ship the table first.\n", "");
    await writeDoc(edited);
    const fresh = await service.state(DOC);
    expect(fresh.threads[0]?.status).toBe("outdated");
    const id = view.threads[0]?.id ?? "";
    await expect(service.acceptSuggestion(DOC, fresh.version, id, fresh.docHash)).rejects.toThrow(/no longer exists/);
  });
});

describe("submitting", () => {
  it("submits drafts and sets the plan's status from the verdict", async () => {
    const view = await comment("Ship the table first.");
    const result = await service.submit(DOC, view.version, "approve", "Looks good");
    expect(result.statusUpdate).toEqual({ status: "updated", value: "approved" });
    expect(await readDoc()).toBe(PLAN.replace("status: review", "status: approved"));
    expect(result.review.reviews[0]).toMatchObject({ state: "submitted", verdict: "approve", body: "Looks good" });
    expect(result.review.draftReviewId).toBeNull();
    expect(result.review.threads[0]?.anchor.docHash).toBe(docHash(await readDoc()));
  });

  it("maps request changes to draft and leaves the status alone for comments", async () => {
    let view = await service.state(DOC);
    view = (await service.submit(DOC, view.version, "comment", "")).review;
    expect(await readDoc()).toBe(PLAN);
    const result = await service.submit(DOC, view.version, "request_changes", "");
    expect(result.statusUpdate).toEqual({ status: "updated", value: "draft" });
    expect(await readDoc()).toContain("status: draft");
  });

  it("still submits when the frontmatter can't be edited safely", async () => {
    const broken = "---\ntitle: [oops\n---\n# Feed\n\nBody.\n";
    await writeDoc(broken);
    const view = await service.state(DOC);
    const result = await service.submit(DOC, view.version, "approve", "");
    expect(result.statusUpdate.status).toBe("failed");
    expect(result.review.reviews[0]?.state).toBe("submitted");
    expect(await readDoc()).toBe(broken);
  });
});

describe("question answers and addressing", () => {
  it("keeps one draft answer per question, sends it with the review and records Claude's acknowledgement", async () => {
    let view = await service.state(DOC);
    const answer = { questionId: "gate", prompt: "Gate it?", choice: 1, choiceText: "Dark-write", note: "" };
    view = await service.answer(DOC, view.version, answer);
    view = await service.answer(DOC, view.version, { ...answer, note: "  with a kill switch " });
    expect(view.answers).toHaveLength(1);
    expect(view.answers[0]).toMatchObject({ note: "with a kill switch", reviewId: view.draftReviewId });
    await expect(service.acknowledgeAnswer(DOC, "gate", "noted")).rejects.toThrow(/No submitted answer/);
    view = (await service.submit(DOC, view.version, "comment", "")).review;
    view = await service.acknowledgeAnswer(DOC, "gate", "Went with dark-writes");
    expect(view.answers[0]?.ack?.message).toBe("Went with dark-writes");
  });

  it("clears a draft answer when both choice and note are empty", async () => {
    let view = await service.state(DOC);
    view = await service.answer(DOC, view.version, {
      questionId: "q",
      prompt: "",
      choice: 0,
      choiceText: "A",
      note: "",
    });
    view = await service.answer(DOC, view.version, {
      questionId: "q",
      prompt: "",
      choice: null,
      choiceText: null,
      note: "",
    });
    expect(view.answers).toEqual([]);
  });

  it("lets Claude reply, resolve and mark the review addressed", async () => {
    let view = await comment("Ship the table first.");
    const id = view.threads[0]?.id ?? "";
    view = (await service.submit(DOC, view.version, "request_changes", "")).review;
    view = await service.setResolved(DOC, null, id, true, { actor: CLAUDE_ACTOR, message: "Done" });
    expect(view.threads[0]).toMatchObject({ status: "resolved", resolvedBy: "claude" });
    expect(view.threads[0]?.messages.at(-1)).toMatchObject({ author: "claude", name: "Claude", body: "Done" });
    view = await service.markAddressed(DOC);
    expect(view.reviews[0]?.state).toBe("addressed");
    await expect(service.markAddressed(DOC)).rejects.toThrow(ReviewOperationError);
  });
});

describe("re-anchoring on read", () => {
  it("persists refreshed anchors once when the plan changes", async () => {
    const view = await comment("Ship the table first.");
    await writeDoc(PLAN.replace("## Rollout\n", "## Rollout\n\nNew intro.\n"));
    const first = await service.state(DOC);
    expect(first.version).toBe(view.version + 1);
    expect(first.threads[0]?.anchor.start).toBeGreaterThan(view.threads[0]?.anchor.start ?? 0);
    const second = await service.state(DOC);
    expect(second.version).toBe(first.version);
  });
});
