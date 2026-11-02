import type { ReviewView, Thread } from "@timthink/server";
import { describe, expect, it } from "vitest";
import { claudeActivity, excerpt, highlightSpan, pendingCounts, sectionTitle } from "./reviewModel";

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    reviewId: "r-1",
    kind: "comment",
    anchor: { quote: "q", prefix: "", suffix: "", headingPath: [], start: 0, end: 1, docHash: "h" },
    suggestion: null,
    status: "open",
    createdAt: "",
    resolvedAt: null,
    resolvedBy: null,
    messages: [],
    ...overrides,
  };
}

function view(overrides: Partial<ReviewView>): ReviewView {
  return {
    schemaVersion: 1,
    doc: "r/p.md",
    version: 1,
    reviews: [],
    threads: [],
    answers: [],
    docHash: "h",
    draftReviewId: null,
    userName: "You",
    ...overrides,
  };
}

describe("pendingCounts", () => {
  it("counts draft threads, draft replies on submitted threads and draft answers", () => {
    const counts = pendingCounts(
      view({
        draftReviewId: "r-2",
        threads: [
          thread("t-1", { reviewId: "r-2" }),
          thread("t-2", {
            messages: [{ id: "m-1", author: "human", name: "", at: "", body: "", reviewId: "r-2" }],
          }),
        ],
        answers: [
          { questionId: "q", reviewId: "r-2", prompt: "", choice: 0, choiceText: "", note: "", at: "", ack: null },
        ],
      }),
    );
    expect(counts).toEqual({ comments: 1, replies: 1, answers: 1, total: 3 });
  });
});

describe("claudeActivity", () => {
  it("finds new Claude replies, Claude resolutions and newly addressed reviews", () => {
    const reply = { id: "m-9", author: "claude" as const, name: "Claude", at: "", body: "Done", reviewId: null };
    const before = view({ threads: [thread("t-1"), thread("t-2")], reviews: [] });
    const after = view({
      threads: [thread("t-1", { messages: [reply] }), thread("t-2", { status: "resolved", resolvedBy: "claude" })],
      reviews: [
        {
          id: "r-1",
          state: "addressed",
          verdict: "comment",
          body: "",
          author: "",
          createdAt: "",
          submittedAt: "",
          addressedAt: "",
        },
      ],
    });
    const activity = claudeActivity(before, after);
    expect(activity.replies.map((entry) => entry.id)).toEqual(["t-1"]);
    expect(activity.resolved.map((entry) => entry.id)).toEqual(["t-2"]);
    expect(activity.addressed).toBe(true);
    expect(claudeActivity(after, after)).toEqual({ replies: [], resolved: [], addressed: false });
  });
});

describe("excerpt", () => {
  it("flattens whitespace and truncates", () => {
    expect(excerpt("a\n  b", 10)).toBe("a b");
    expect(excerpt("abcdefghijkl", 6)).toBe("abcde…");
  });
});

describe("section anchors", () => {
  it("highlights only the heading line of a whole-section comment", () => {
    const quote = "### Anchoring\n\nEach thread stores an anchor.";
    expect(sectionTitle(quote)).toBe("Anchoring");
    expect(highlightSpan(quote, 100, 100 + quote.length)).toEqual({ start: 100, end: 113 });
    expect(sectionTitle("plain words")).toBeNull();
    expect(highlightSpan("plain words", 5, 16)).toEqual({ start: 5, end: 16 });
  });
});
