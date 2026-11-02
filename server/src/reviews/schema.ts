import { z } from "zod";

export const REVIEW_SCHEMA_VERSION = 1;

export const anchorSchema = z.object({
  quote: z.string().min(1),
  prefix: z.string(),
  suffix: z.string(),
  headingPath: z.array(z.string()),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  docHash: z.string(),
});

export const authorSchema = z.enum(["human", "claude"]);
export const verdictSchema = z.enum(["approve", "request_changes", "comment"]);
export const reviewStateSchema = z.enum(["draft", "submitted", "addressed"]);
export const threadKindSchema = z.enum(["comment", "suggestion"]);
export const threadStatusSchema = z.enum(["open", "resolved", "outdated"]);

export const messageSchema = z.object({
  id: z.string().min(1),
  author: authorSchema,
  name: z.string(),
  at: z.string(),
  body: z.string(),
  reviewId: z.string().nullable(),
});

export const threadSchema = z.object({
  id: z.string().min(1),
  reviewId: z.string().min(1),
  kind: threadKindSchema,
  anchor: anchorSchema,
  suggestion: z.string().nullable(),
  status: threadStatusSchema,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedBy: authorSchema.nullable(),
  messages: z.array(messageSchema),
});

export const reviewSchema = z.object({
  id: z.string().min(1),
  state: reviewStateSchema,
  verdict: verdictSchema.nullable(),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),
  submittedAt: z.string().nullable(),
  addressedAt: z.string().nullable(),
});

export const answerAckSchema = z.object({ at: z.string(), message: z.string() });

export const answerSchema = z.object({
  questionId: z.string().min(1),
  reviewId: z.string().min(1),
  prompt: z.string(),
  choice: z.number().int().nonnegative().nullable(),
  choiceText: z.string().nullable(),
  note: z.string(),
  at: z.string(),
  ack: answerAckSchema.nullable(),
});

export const reviewFileSchema = z.object({
  schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
  doc: z.string().min(1),
  version: z.number().int().nonnegative(),
  reviews: z.array(reviewSchema),
  threads: z.array(threadSchema),
  answers: z.array(answerSchema),
});

export type Anchor = z.infer<typeof anchorSchema>;
export type Author = z.infer<typeof authorSchema>;
export type Verdict = z.infer<typeof verdictSchema>;
export type ReviewState = z.infer<typeof reviewStateSchema>;
export type ThreadKind = z.infer<typeof threadKindSchema>;
export type ThreadStatus = z.infer<typeof threadStatusSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type ReviewFile = z.infer<typeof reviewFileSchema>;

export function emptyReviewFile(docPath: string): ReviewFile {
  return { schemaVersion: REVIEW_SCHEMA_VERSION, doc: docPath, version: 0, reviews: [], threads: [], answers: [] };
}

export const MAX_COMMENT_LENGTH = 20_000;
export const MAX_SUGGESTION_LENGTH = 100_000;
