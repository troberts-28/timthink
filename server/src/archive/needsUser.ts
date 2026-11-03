import { draftReview, unaddressedReviews } from "../reviews/operations.js";
import type { ReviewFile, Thread } from "../reviews/schema.js";

export type ThreadReadAt = (threadId: string) => string | null;

function hasDraftContent(file: ReviewFile): boolean {
  const draft = draftReview(file);
  if (!draft) return false;
  return (
    draft.body.trim() !== "" ||
    file.answers.some((answer) => answer.reviewId === draft.id) ||
    file.threads.some((thread) => thread.reviewId === draft.id || thread.messages.some((m) => m.reviewId === draft.id))
  );
}

function hasUnreadClaudeReply(thread: Thread, readAt: string | null): boolean {
  const last = thread.messages.at(-1);
  return last?.author === "claude" && (readAt === null || readAt < last.at);
}

export function reviewNeedsUser(file: ReviewFile, threadReadAt: ThreadReadAt): boolean {
  if (unaddressedReviews(file).length > 0 || hasDraftContent(file)) return true;
  return file.threads.some(
    (thread) => thread.status === "open" && hasUnreadClaudeReply(thread, threadReadAt(thread.id)),
  );
}
