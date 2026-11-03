import { describe, expect, it } from "vitest";
import type { DocQuestion } from "../docs/content.js";
import type { DocSummary } from "../docs/types.js";
import type { Message, Review, ReviewFile, Thread } from "../reviews/schema.js";
import { emptyReviewFile } from "../reviews/schema.js";
import { buildInbox, type InboxDocInput } from "./buildInbox.js";

const NOW = new Date("2026-11-02T12:00:00.000Z");
const INITIALISED = "2026-10-20T09:00:00.000Z";

function summary(path: string, overrides: Partial<DocSummary> = {}): DocSummary {
  const [repo = "acme", ...rest] = path.split("/");
  return {
    path,
    repo,
    project: null,
    relPath: rest.join("/"),
    title: rest.join("/"),
    date: "2026-11-01",
    mtime: Date.parse("2026-11-01T10:00:00.000Z"),
    status: null,
    branch: null,
    pr: null,
    linear: null,
    tasks: { done: 0, total: 0 },
    frontmatterError: null,
    ...overrides,
  };
}

function review(
  id: string,
  state: Review["state"],
  submittedAt: string | null,
  addressedAt: string | null = null,
): Review {
  return {
    id,
    state,
    verdict: state === "draft" ? null : "comment",
    body: "",
    author: "Sam",
    createdAt: "2026-10-30T09:00:00.000Z",
    submittedAt,
    addressedAt,
  };
}

function message(author: Message["author"], at: string, body: string, reviewId: string | null): Message {
  return { id: `m-${at}`, author, name: author === "claude" ? "Claude" : "Sam", at, body, reviewId };
}

function thread(id: string, reviewId: string, messages: Message[]): Thread {
  return {
    id,
    reviewId,
    kind: "comment",
    anchor: { quote: "x", prefix: "", suffix: "", headingPath: [], start: 0, end: 1, docHash: "h" },
    suggestion: null,
    status: "open",
    createdAt: "2026-10-30T09:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    messages,
  };
}

function doc(path: string, overrides: Partial<InboxDocInput> = {}): InboxDocInput {
  return {
    summary: summary(path),
    archived: false,
    hash: "current",
    questions: [],
    review: null,
    seen: { hash: "current", at: "2026-11-01T11:00:00.000Z", previous: null },
    latestChange: null,
    session: null,
    ...overrides,
  };
}

function inbox(docs: InboxDocInput[], threadReads: Record<string, string> = {}) {
  return buildInbox({
    docs,
    seenInitialisedAt: INITIALISED,
    threadReadAt: (docPath, threadId) => threadReads[`${docPath}#${threadId}`] ?? null,
    now: NOW,
  });
}

const question: DocQuestion = {
  id: "gate",
  prompt: "Should writes be gated?",
  options: [
    { label: "Yes", summary: "Safer rollout.", recommended: true },
    { label: "No", summary: null, recommended: false },
  ],
  details: { markdown: "### Recommendation\nGate it.", offset: 40, lineIndex: 4 },
  line: 12,
};

describe("buildInbox", () => {
  it("is empty when everything has been seen", () => {
    const result = inbox([
      doc("acme/a.md"),
      doc("garden/b.md", { summary: summary("garden/b.md", { status: "done" }) }),
    ]);
    expect(result.items).toEqual([]);
    expect(result.attention).toEqual({ total: 0, byRepo: {} });
  });

  it("collects each kind of item into its section, in section order", () => {
    const waitingFile: ReviewFile = {
      ...emptyReviewFile("acme/waiting.md"),
      reviews: [review("r-1", "submitted", "2026-11-02T08:00:00.000Z")],
    };
    const repliedFile: ReviewFile = {
      ...emptyReviewFile("acme/replied.md"),
      reviews: [review("r-1", "addressed", "2026-11-01T08:00:00.000Z", "2026-11-01T09:00:00.000Z")],
      threads: [
        thread("t-1", "r-1", [
          message("human", "2026-11-01T08:00:00.000Z", "Why?", "r-1"),
          message("claude", "2026-11-02T09:30:00.000Z", "Because the feed needs it.", null),
        ]),
        thread("t-2", "r-1", [
          message("human", "2026-11-01T08:00:00.000Z", "And?", "r-1"),
          message("claude", "2026-11-02T09:00:00.000Z", "Done.", null),
        ]),
      ],
    };
    const result = inbox([
      doc("acme/review.md", { summary: summary("acme/review.md", { status: "review" }) }),
      doc("acme/waiting.md", {
        summary: summary("acme/waiting.md", { status: "review" }),
        review: waitingFile,
        session: { id: "s-1", title: "Feed", live: true, canFocus: true, canResume: true },
      }),
      doc("acme/replied.md", { review: repliedFile }),
      doc("garden/question.md", { questions: [question, { ...question, id: null }] }),
      doc("garden/edited.md", {
        hash: "new",
        latestChange: {
          at: "2026-11-02T11:00:00.000Z",
          attribution: { kind: "claude", sessionId: "s-2", sessionTitle: "Garden" },
        },
      }),
    ]);
    expect(result.items.map((item) => [item.section, item.reason, item.doc.path])).toEqual([
      ["review", "review-requested", "acme/review.md"],
      ["replies", "claude-replied", "acme/replied.md"],
      ["questions", "open-question", "garden/question.md"],
      ["waiting", "waiting-on-claude", "acme/waiting.md"],
      ["changed", "edited", "garden/edited.md"],
    ]);
    const replies = result.items.find((item) => item.reason === "claude-replied");
    expect(replies).toMatchObject({ count: 2, detail: "Because the feed needs it.", at: "2026-11-02T09:30:00.000Z" });
    const open = result.items.find((item) => item.section === "questions");
    expect(open?.detail).toBe("Should writes be gated?");
    expect(open?.question).toEqual({
      prompt: "Should writes be gated?",
      options: question.options,
      details: "### Recommendation\nGate it.",
    });
    expect(result.items.find((item) => item.section === "waiting")?.session?.id).toBe("s-1");
    expect(result.attention).toEqual({ total: 4, byRepo: { acme: 2, garden: 2 } });
  });

  it("flags an addressed review until the change is seen, instead of listing the edit separately", () => {
    const file: ReviewFile = {
      ...emptyReviewFile("acme/a.md"),
      reviews: [review("r-1", "addressed", "2026-11-01T08:00:00.000Z", "2026-11-02T10:00:00.000Z")],
    };
    const unseen = inbox([
      doc("acme/a.md", {
        review: file,
        hash: "after",
        latestChange: { at: "2026-11-02T10:00:00.000Z", attribution: { kind: "unknown" } },
      }),
    ]);
    expect(unseen.items.map((item) => item.reason)).toEqual(["review-addressed"]);
    const seen = inbox([
      doc("acme/a.md", { review: file, seen: { hash: "current", at: "2026-11-02T10:30:00.000Z", previous: null } }),
    ]);
    expect(seen.items).toEqual([]);
  });

  it("hides Claude replies once the doc or the thread has been read", () => {
    const file: ReviewFile = {
      ...emptyReviewFile("acme/a.md"),
      reviews: [review("r-1", "addressed", "2026-11-01T08:00:00.000Z", "2026-11-01T09:00:00.000Z")],
      threads: [thread("t-1", "r-1", [message("claude", "2026-11-02T09:30:00.000Z", "Reply", null)])],
    };
    expect(inbox([doc("acme/a.md", { review: file })]).items).toHaveLength(1);
    expect(inbox([doc("acme/a.md", { review: file })], { "acme/a.md#t-1": "2026-11-02T09:31:00.000Z" }).items).toEqual(
      [],
    );
  });

  it("hides archived docs unless Claude replied or addressed a review", () => {
    const replied: ReviewFile = {
      ...emptyReviewFile("acme/a.md"),
      reviews: [review("r-1", "addressed", "2026-11-01T08:00:00.000Z", "2026-11-01T09:00:00.000Z")],
      threads: [thread("t-1", "r-1", [message("claude", "2026-11-02T09:30:00.000Z", "Reply", null)])],
    };
    const items = inbox([
      doc("acme/a.md", { review: replied, archived: true, hash: "after" }),
      doc("acme/b.md", { archived: true, questions: [question], hash: "after" }),
    ]).items;
    expect(items.map((item) => [item.reason, item.doc.path])).toEqual([["claude-replied", "acme/a.md"]]);
  });

  it("drops answered questions and questions in settled plans", () => {
    const answered: ReviewFile = {
      ...emptyReviewFile("acme/a.md"),
      answers: [
        { questionId: "gate", reviewId: "r-1", prompt: "", choice: 0, choiceText: "Yes", note: "", at: "", ack: null },
      ],
    };
    expect(inbox([doc("acme/a.md", { questions: [question], review: answered })]).items).toEqual([]);
    expect(
      inbox([doc("acme/a.md", { questions: [question], summary: summary("acme/a.md", { status: "done" }) })]).items,
    ).toEqual([]);
  });

  it("limits changes to the last 14 days and lists docs created after the first run as new", () => {
    const old = doc("acme/old.md", {
      hash: "new",
      latestChange: { at: "2026-10-01T10:00:00.000Z", attribution: { kind: "unknown" } },
    });
    const created = doc("acme/created.md", {
      seen: null,
      summary: summary("acme/created.md", { mtime: Date.parse("2026-11-02T07:00:00.000Z") }),
      latestChange: { at: "2026-11-02T07:00:00.000Z", attribution: { kind: "unknown" } },
    });
    const legacy = doc("acme/legacy.md", {
      seen: null,
      summary: summary("acme/legacy.md", { mtime: Date.parse("2026-10-19T07:00:00.000Z") }),
    });
    expect(inbox([old, created, legacy]).items.map((item) => [item.reason, item.doc.path])).toEqual([
      ["new", "acme/created.md"],
    ]);
  });
});
