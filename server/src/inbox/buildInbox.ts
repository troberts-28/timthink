import type { DocQuestion } from "../docs/content.js";
import type { DocSummary } from "../docs/types.js";
import type { Attribution } from "../history/attribution.js";
import { isDraftThread, unaddressedReviews } from "../reviews/operations.js";
import type { Review, ReviewFile, Thread } from "../reviews/schema.js";
import type { SeenEntry } from "../seen/seenStore.js";
import type { InboxAttention, InboxDoc, InboxItem, InboxResponse, InboxSection, InboxSessionHint } from "./types.js";

export const CHANGED_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const DETAIL_LENGTH = 160;
const REVIEW_STATUSES = new Set(["review", "needs-review", "needs review"]);
const SETTLED_STATUSES = new Set(["done", "abandoned", "complete", "completed", "shipped"]);

export interface LatestChange {
  at: string;
  attribution: Attribution;
}

export interface InboxDocInput {
  summary: DocSummary;
  hash: string;
  questions: readonly DocQuestion[];
  review: ReviewFile | null;
  seen: SeenEntry | null;
  latestChange: LatestChange | null;
  session: InboxSessionHint | null;
}

export interface InboxInput {
  docs: readonly InboxDocInput[];
  seenInitialisedAt: string;
  threadReadAt: (docPath: string, threadId: string) => string | null;
  now: Date;
}

const SECTION_ORDER: readonly InboxSection[] = ["review", "replies", "questions", "waiting", "changed"];

function later(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > DETAIL_LENGTH ? `${flat.slice(0, DETAIL_LENGTH - 1).trimEnd()}…` : flat;
}

function inboxDoc(summary: DocSummary, hash: string): InboxDoc {
  const { path, repo, project, title, status } = summary;
  return { path, repo, project, title, status, hash };
}

function latestSubmitted(file: ReviewFile | null): Review | null {
  const submitted = (file?.reviews ?? []).filter((review) => review.state !== "draft" && review.submittedAt);
  return submitted.sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "")).at(-1) ?? null;
}

function hasAnswer(file: ReviewFile | null, questionId: string): boolean {
  return (file?.answers ?? []).some((answer) => answer.questionId === questionId);
}

function claudeReplies(input: InboxDocInput, threadReadAt: InboxInput["threadReadAt"]) {
  const file = input.review;
  if (!file) return [];
  return file.threads
    .filter((thread) => !isDraftThread(file, thread))
    .flatMap((thread: Thread) => {
      const last = thread.messages.at(-1);
      if (last?.author !== "claude") return [];
      const readAt = later(input.seen?.at, threadReadAt(input.summary.path, thread.id));
      return readAt && readAt >= last.at ? [] : [last];
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

function item(
  input: InboxDocInput,
  fields: Pick<InboxItem, "section" | "reason" | "at"> & Partial<InboxItem>,
): InboxItem {
  return {
    id: `${fields.reason}:${input.summary.path}${fields.questionId ? `#${fields.questionId}` : ""}`,
    doc: inboxDoc(input.summary, input.hash),
    detail: null,
    count: 1,
    questionId: null,
    attribution: null,
    session: null,
    ...fields,
  };
}

function itemsForDoc(input: InboxDocInput, context: InboxInput): InboxItem[] {
  const { summary, review, seen } = input;
  const items: InboxItem[] = [];
  const mtime = new Date(summary.mtime).toISOString();
  const waiting = review ? unaddressedReviews(review) : [];
  const latest = latestSubmitted(review);

  if (waiting.length > 0) {
    const submittedAt =
      waiting
        .map((entry) => entry.submittedAt ?? entry.createdAt)
        .sort()
        .at(-1) ?? mtime;
    items.push(
      item(input, { section: "waiting", reason: "waiting-on-claude", at: submittedAt, session: input.session }),
    );
  } else if (latest?.state === "addressed" && latest.addressedAt && (!seen || seen.at < latest.addressedAt)) {
    items.push(item(input, { section: "review", reason: "review-addressed", at: latest.addressedAt }));
  } else if (summary.status && REVIEW_STATUSES.has(summary.status)) {
    items.push(item(input, { section: "review", reason: "review-requested", at: mtime }));
  }

  const replies = claudeReplies(input, context.threadReadAt);
  const lastReply = replies.at(-1);
  if (lastReply) {
    items.push(
      item(input, {
        section: "replies",
        reason: "claude-replied",
        at: lastReply.at,
        detail: clip(lastReply.body),
        count: replies.length,
      }),
    );
  }

  if (!summary.status || !SETTLED_STATUSES.has(summary.status)) {
    for (const question of input.questions) {
      if (!question.id || hasAnswer(review, question.id)) continue;
      items.push(
        item(input, {
          section: "questions",
          reason: "open-question",
          at: mtime,
          detail: clip(question.prompt) || null,
          questionId: question.id,
        }),
      );
    }
  }

  const change = changeSinceSeen(input, context);
  if (change && !items.some((entry) => entry.reason === "review-addressed")) items.push(change);
  return items;
}

function changeSinceSeen(input: InboxDocInput, context: InboxInput): InboxItem | null {
  const { seen, summary, latestChange } = input;
  const at = latestChange?.at ?? new Date(summary.mtime).toISOString();
  if (context.now.getTime() - Date.parse(at) > CHANGED_WINDOW_DAYS * DAY_MS) return null;
  if (seen) {
    if (seen.hash === input.hash) return null;
    return item(input, { section: "changed", reason: "edited", at, attribution: latestChange?.attribution ?? null });
  }
  if (at <= context.seenInitialisedAt) return null;
  return item(input, { section: "changed", reason: "new", at, attribution: latestChange?.attribution ?? null });
}

function attention(items: readonly InboxItem[]): InboxAttention {
  const byRepo: Record<string, number> = {};
  let total = 0;
  for (const entry of items) {
    if (entry.section === "waiting") continue;
    total += 1;
    byRepo[entry.doc.repo] = (byRepo[entry.doc.repo] ?? 0) + 1;
  }
  return { total, byRepo };
}

function inboxOrder(a: InboxItem, b: InboxItem): number {
  return (
    SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
    b.at.localeCompare(a.at) ||
    a.id.localeCompare(b.id)
  );
}

export function buildInbox(input: InboxInput): InboxResponse {
  const items = input.docs.flatMap((doc) => itemsForDoc(doc, input)).sort(inboxOrder);
  return { generatedAt: input.now.toISOString(), items, attention: attention(items) };
}
