import { describe, expect, it } from "vitest";
import type { Message, Review, ReviewFile, Thread } from "../reviews/schema.js";
import { reviewNeedsUser } from "./needsUser.js";

function review(id: string, state: Review["state"]): Review {
  return {
    id,
    state,
    verdict: state === "draft" ? null : "comment",
    body: "",
    author: "Sam",
    createdAt: "2026-10-30T09:00:00.000Z",
    submittedAt: state === "draft" ? null : "2026-10-30T10:00:00.000Z",
    addressedAt: state === "addressed" ? "2026-10-31T10:00:00.000Z" : null,
  };
}

function message(author: Message["author"], at: string, reviewId: string | null): Message {
  return { id: `m-${at}`, author, name: author, at, body: "text", reviewId };
}

function thread(status: Thread["status"], messages: Message[], reviewId = "r-1"): Thread {
  return {
    id: "t-1",
    reviewId,
    kind: "comment",
    anchor: { quote: "x", prefix: "", suffix: "", headingPath: [], start: 0, end: 1, docHash: "h" },
    suggestion: null,
    status,
    createdAt: "2026-10-30T09:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    messages,
  };
}

function file(reviews: Review[], threads: Thread[] = []): ReviewFile {
  return { schemaVersion: 1, doc: "repo/plan.md", version: 3, reviews, threads, answers: [] };
}

const neverRead = () => null;
const CLAUDE_AT = "2026-10-31T09:00:00.000Z";

describe("reviewNeedsUser", () => {
  it("is true while a submitted review waits to be addressed", () => {
    expect(reviewNeedsUser(file([review("r-1", "submitted")]), neverRead)).toBe(true);
    expect(reviewNeedsUser(file([review("r-1", "addressed")]), neverRead)).toBe(false);
  });

  it("is true when an open thread has an unread Claude reply", () => {
    const threads = [
      thread("open", [message("human", "2026-10-30T10:00:00.000Z", "r-1"), message("claude", CLAUDE_AT, null)]),
    ];
    const reviewed = file([review("r-1", "addressed")], threads);
    expect(reviewNeedsUser(reviewed, neverRead)).toBe(true);
    expect(reviewNeedsUser(reviewed, () => "2026-11-01T00:00:00.000Z")).toBe(false);
  });

  it("ignores Claude replies on resolved or outdated threads", () => {
    for (const status of ["resolved", "outdated"] as const) {
      const threads = [thread(status, [message("claude", CLAUDE_AT, null)])];
      expect(reviewNeedsUser(file([review("r-1", "addressed")], threads), neverRead)).toBe(false);
    }
  });

  it("is true when there are unsent drafts", () => {
    const draft = review("r-2", "draft");
    const threads = [thread("open", [message("human", CLAUDE_AT, "r-2")], "r-2")];
    expect(reviewNeedsUser(file([review("r-1", "addressed"), draft], threads), neverRead)).toBe(true);
    expect(reviewNeedsUser(file([review("r-1", "addressed"), draft]), neverRead)).toBe(false);
  });
});
