import type { DocQuestion } from "../docs/content.js";
import type { DocSummary } from "../docs/types.js";
import type { ReviewFile } from "../reviews/schema.js";
import type { RoundSummary } from "../rounds/roundView.js";
import type { InboxAttention, InboxItem, InboxResponse } from "./types.js";

const REVIEW_STATUSES = new Set(["review", "needs-review", "needs review"]);

export interface InboxDocInput {
  summary: DocSummary;
  archived: boolean;
  hash: string;
  questions: readonly DocQuestion[];
  review: ReviewFile | null;
}

export interface InboxInput {
  docs: readonly InboxDocInput[];
  rounds: readonly RoundSummary[];
  now: Date;
}

export function buildInbox(input: InboxInput): InboxResponse {
  const items = [...input.rounds.flatMap(roundItem), ...input.docs.flatMap(questionItems)].sort(inboxOrder);
  return { generatedAt: input.now.toISOString(), items, attention: attention(items) };
}

function roundItem(round: RoundSummary): InboxItem[] {
  if (round.state !== "open") {
    return [];
  }
  return [{ kind: "round", id: `round:${round.id}`, at: round.createdAt, repo: round.repo, round }];
}

function questionItems(input: InboxDocInput): InboxItem[] {
  const { summary, review } = input;
  const isAskingForReview = summary.status !== null && REVIEW_STATUSES.has(summary.status);
  if (input.archived || !isAskingForReview) {
    return [];
  }
  const draftReviews = new Set(
    (review?.reviews ?? []).filter((entry) => entry.state === "draft").map((entry) => entry.id),
  );
  const sentAnswers = (review?.answers ?? []).filter((answer) => !draftReviews.has(answer.reviewId));
  const answered = new Set(sentAnswers.map((answer) => answer.questionId));
  const { path, repo, project, title, status } = summary;
  return input.questions.flatMap((question): InboxItem[] => {
    if (!question.id || answered.has(question.id)) {
      return [];
    }
    return [
      {
        kind: "question",
        id: `question:${path}#${question.id}`,
        at: new Date(summary.mtime).toISOString(),
        repo,
        doc: { path, repo, project, title, status, hash: input.hash },
        questionId: question.id,
        question: { prompt: question.prompt, options: question.options, details: question.details?.markdown ?? null },
      },
    ];
  });
}

function attention(items: readonly InboxItem[]): InboxAttention {
  const byRepo: Record<string, number> = {};
  for (const entry of items) {
    byRepo[entry.repo] = (byRepo[entry.repo] ?? 0) + 1;
  }
  return { total: items.length, byRepo };
}

function inboxOrder(a: InboxItem, b: InboxItem) {
  return (
    Number(a.kind === "question") - Number(b.kind === "question") ||
    b.at.localeCompare(a.at) ||
    a.id.localeCompare(b.id)
  );
}
