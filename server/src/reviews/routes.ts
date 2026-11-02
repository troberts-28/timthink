import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { InvalidRangeError } from "./anchor.js";
import { ReviewOperationError } from "./operations.js";
import { DocChangedError, DocNotFoundError, type ReviewService } from "./reviewService.js";
import { CorruptReviewFileError, InvalidDocPathError, ReviewConflictError } from "./reviewStore.js";
import { MAX_COMMENT_LENGTH, MAX_SUGGESTION_LENGTH, threadKindSchema, verdictSchema } from "./schema.js";

export type ReviewErrorCode = "conflict" | "doc-changed" | "not-found" | "invalid" | "corrupt";

export interface ReviewErrorResponse {
  error: ReviewErrorCode;
  message: string;
}

const docQuery = z.object({ path: z.string().min(1) });
const idParam = z.object({ id: z.string().min(1).max(64) });
const versioned = z.object({ path: z.string().min(1), version: z.number().int().nonnegative() });
const commentText = z.string().max(MAX_COMMENT_LENGTH);
const suggestionText = z.string().max(MAX_SUGGESTION_LENGTH);

const newThreadBody = versioned.extend({
  docHash: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  kind: threadKindSchema,
  body: commentText,
  suggestion: suggestionText.nullable(),
});
const editThreadBody = versioned.extend({ body: commentText, suggestion: suggestionText.nullable() });
const replyBody = versioned.extend({ body: commentText.min(1) });
const resolveBody = versioned.extend({ resolved: z.boolean() });
const acceptBody = versioned.extend({ docHash: z.string().min(1) });
const answerBody = versioned.extend({
  questionId: z.string().min(1).max(200),
  prompt: z.string().max(MAX_COMMENT_LENGTH),
  choice: z.number().int().nonnegative().nullable(),
  choiceText: z.string().max(MAX_COMMENT_LENGTH).nullable(),
  note: commentText,
});
const submitBody = versioned.extend({ verdict: verdictSchema, body: commentText });

function failure(c: Context, error: unknown) {
  const respond = (code: ReviewErrorCode, status: 404 | 409 | 422 | 500, message: string) =>
    c.json<ReviewErrorResponse, typeof status>({ error: code, message }, status);
  if (error instanceof ReviewConflictError) return respond("conflict", 409, error.message);
  if (error instanceof DocChangedError) return respond("doc-changed", 409, error.message);
  if (error instanceof ReviewOperationError) {
    return respond(error.code, error.code === "not-found" ? 404 : 422, error.message);
  }
  if (error instanceof InvalidRangeError) return respond("invalid", 422, error.message);
  if (error instanceof DocNotFoundError || error instanceof InvalidDocPathError) {
    return respond("not-found", 404, error.message);
  }
  if (error instanceof CorruptReviewFileError) return respond("corrupt", 500, error.message);
  throw error;
}

async function attempt<T>(c: Context, work: () => Promise<T>) {
  try {
    return c.json(await work());
  } catch (error) {
    return failure(c, error);
  }
}

export function reviewRoutes(reviews: ReviewService) {
  return new Hono()
    .get("/", zValidator("query", docQuery), (c) => attempt(c, () => reviews.state(c.req.valid("query").path)))
    .post("/threads", zValidator("json", newThreadBody), (c) => {
      const { path, ...request } = c.req.valid("json");
      return attempt(c, () => reviews.createThread(path, request));
    })
    .post("/threads/:id/edit", zValidator("param", idParam), zValidator("json", editThreadBody), (c) => {
      const { path, version, body, suggestion } = c.req.valid("json");
      return attempt(c, () => reviews.editThread(path, version, c.req.valid("param").id, { body, suggestion }));
    })
    .post("/threads/:id/delete", zValidator("param", idParam), zValidator("json", versioned), (c) => {
      const { path, version } = c.req.valid("json");
      return attempt(c, () => reviews.deleteThread(path, version, c.req.valid("param").id));
    })
    .post("/threads/:id/reply", zValidator("param", idParam), zValidator("json", replyBody), (c) => {
      const { path, version, body } = c.req.valid("json");
      return attempt(c, () => reviews.reply(path, version, c.req.valid("param").id, body));
    })
    .post("/threads/:id/resolve", zValidator("param", idParam), zValidator("json", resolveBody), (c) => {
      const { path, version, resolved } = c.req.valid("json");
      return attempt(c, () => reviews.setResolved(path, version, c.req.valid("param").id, resolved));
    })
    .post("/threads/:id/accept", zValidator("param", idParam), zValidator("json", acceptBody), (c) => {
      const { path, version, docHash } = c.req.valid("json");
      return attempt(c, () => reviews.acceptSuggestion(path, version, c.req.valid("param").id, docHash));
    })
    .post("/messages/:id/delete", zValidator("param", idParam), zValidator("json", versioned), (c) => {
      const { path, version } = c.req.valid("json");
      return attempt(c, () => reviews.deleteMessage(path, version, c.req.valid("param").id));
    })
    .post("/answers", zValidator("json", answerBody), (c) => {
      const { path, version, ...input } = c.req.valid("json");
      return attempt(c, () => reviews.answer(path, version, input));
    })
    .post("/submit", zValidator("json", submitBody), (c) => {
      const { path, version, verdict, body } = c.req.valid("json");
      return attempt(c, () => reviews.submit(path, version, verdict, body));
    });
}
