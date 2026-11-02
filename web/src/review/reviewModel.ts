import type { Answer, Message, Review, ReviewView, Thread } from "@timthink/server";

export function isDraftThread(review: ReviewView, thread: Thread): boolean {
  return review.draftReviewId !== null && thread.reviewId === review.draftReviewId;
}

export function isDraftMessage(review: ReviewView, message: Message): boolean {
  return review.draftReviewId !== null && message.reviewId === review.draftReviewId;
}

export interface PendingCounts {
  comments: number;
  replies: number;
  answers: number;
  total: number;
}

export function pendingCounts(review: ReviewView | undefined): PendingCounts {
  if (!review?.draftReviewId) return { comments: 0, replies: 0, answers: 0, total: 0 };
  const draftId = review.draftReviewId;
  const comments = review.threads.filter((thread) => thread.reviewId === draftId).length;
  const replies = review.threads
    .filter((thread) => thread.reviewId !== draftId)
    .flatMap((thread) => thread.messages)
    .filter((message) => message.reviewId === draftId).length;
  const answers = review.answers.filter((answer) => answer.reviewId === draftId).length;
  return { comments, replies, answers, total: comments + replies + answers };
}

export function latestSubmittedReview(review: ReviewView | undefined): Review | null {
  const submitted = (review?.reviews ?? []).filter((entry) => entry.state !== "draft" && entry.submittedAt);
  return submitted.sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))[0] ?? null;
}

export function answersFor(
  review: ReviewView | undefined,
  questionId: string,
): { draft: Answer | null; latest: Answer | null } {
  const answers = (review?.answers ?? []).filter((answer) => answer.questionId === questionId);
  const draft = answers.find((answer) => answer.reviewId === review?.draftReviewId) ?? null;
  const latest = answers.filter((answer) => answer !== draft).at(-1) ?? null;
  return { draft, latest };
}

export function byDocumentOrder(a: Thread, b: Thread): number {
  return a.anchor.start - b.anchor.start || a.createdAt.localeCompare(b.createdAt);
}

export function excerpt(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export interface ClaudeActivity {
  replies: Thread[];
  resolved: Thread[];
  addressed: boolean;
}

function claudeMessageIds(thread: Thread | undefined): Set<string> {
  return new Set(
    (thread?.messages ?? []).filter((message) => message.author === "claude").map((message) => message.id),
  );
}

export function claudeActivity(previous: ReviewView, next: ReviewView): ClaudeActivity {
  const before = new Map(previous.threads.map((thread) => [thread.id, thread]));
  const replies: Thread[] = [];
  const resolved: Thread[] = [];
  for (const thread of next.threads) {
    const old = before.get(thread.id);
    const known = claudeMessageIds(old);
    if (thread.messages.some((message) => message.author === "claude" && !known.has(message.id))) replies.push(thread);
    if (thread.status === "resolved" && thread.resolvedBy === "claude" && old && old.status !== "resolved") {
      resolved.push(thread);
    }
  }
  const wasAddressed = new Set(previous.reviews.filter((r) => r.state === "addressed").map((r) => r.id));
  const addressed = next.reviews.some((entry) => entry.state === "addressed" && !wasAddressed.has(entry.id));
  return { replies, resolved, addressed };
}

const HEADING_LINE = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/;

export function sectionTitle(quote: string): string | null {
  const firstLine = quote.split("\n", 1)[0] ?? "";
  return quote.includes("\n") ? (HEADING_LINE.exec(firstLine)?.[1] ?? null) : null;
}

export function highlightSpan(quote: string, start: number, end: number): { start: number; end: number } {
  if (!sectionTitle(quote)) return { start, end };
  return { start, end: start + (quote.split("\n", 1)[0]?.length ?? end - start) };
}
