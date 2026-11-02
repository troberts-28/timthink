import type {
  AppType,
  ReviewErrorCode,
  ReviewErrorResponse,
  ReviewView,
  SubmitResult,
  ThreadKind,
  Verdict,
} from "@timthink/server";
import { hc } from "hono/client";
import { sessionToken } from "./client";

const TOKEN_HEADER = "x-timthink-token";
const client = hc<AppType>("/");
const review = client.api.review;

export class ReviewRequestError extends Error {
  constructor(
    readonly code: ReviewErrorCode | "http",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ReviewRequestError";
  }
}

function isErrorBody(value: unknown): value is ReviewErrorResponse {
  return typeof value === "object" && value !== null && "error" in value && "message" in value;
}

async function unwrap<T>(response: { ok: boolean; status: number; json(): Promise<unknown> }): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (isErrorBody(body)) throw new ReviewRequestError(body.error, body.message, response.status);
    throw new ReviewRequestError("http", `Review request failed (${response.status})`, response.status);
  }
  return body as T;
}

async function authHeaders(): Promise<{ headers: Record<string, string> }> {
  return { headers: { [TOKEN_HEADER]: await sessionToken() } };
}

export function isConflict(error: unknown): boolean {
  return error instanceof ReviewRequestError && (error.code === "conflict" || error.code === "doc-changed");
}

export async function fetchReview(path: string): Promise<ReviewView> {
  return unwrap(await review.$get({ query: { path } }));
}

interface Versioned {
  path: string;
  version: number;
}

export interface NewThread extends Versioned {
  docHash: string;
  start: number;
  end: number;
  kind: ThreadKind;
  body: string;
  suggestion: string | null;
}

export async function createThread(input: NewThread): Promise<ReviewView> {
  return unwrap(await review.threads.$post({ json: input }, await authHeaders()));
}

export async function editThread(
  id: string,
  input: Versioned & { body: string; suggestion: string | null },
): Promise<ReviewView> {
  return unwrap(await review.threads[":id"].edit.$post({ param: { id }, json: input }, await authHeaders()));
}

export async function deleteThread(id: string, input: Versioned): Promise<ReviewView> {
  return unwrap(await review.threads[":id"].delete.$post({ param: { id }, json: input }, await authHeaders()));
}

export async function replyToThread(id: string, input: Versioned & { body: string }): Promise<ReviewView> {
  return unwrap(await review.threads[":id"].reply.$post({ param: { id }, json: input }, await authHeaders()));
}

export async function setThreadResolved(id: string, input: Versioned & { resolved: boolean }): Promise<ReviewView> {
  return unwrap(await review.threads[":id"].resolve.$post({ param: { id }, json: input }, await authHeaders()));
}

export async function acceptSuggestion(id: string, input: Versioned & { docHash: string }): Promise<ReviewView> {
  return unwrap(await review.threads[":id"].accept.$post({ param: { id }, json: input }, await authHeaders()));
}

export async function deleteMessage(id: string, input: Versioned): Promise<ReviewView> {
  return unwrap(await review.messages[":id"].delete.$post({ param: { id }, json: input }, await authHeaders()));
}

export interface AnswerInput extends Versioned {
  questionId: string;
  prompt: string;
  choice: number | null;
  choiceText: string | null;
  note: string;
}

export async function saveAnswer(input: AnswerInput): Promise<ReviewView> {
  return unwrap(await review.answers.$post({ json: input }, await authHeaders()));
}

export async function submitReview(input: Versioned & { verdict: Verdict; body: string }): Promise<SubmitResult> {
  return unwrap(await review.submit.$post({ json: input }, await authHeaders()));
}
