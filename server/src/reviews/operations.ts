import { randomBytes } from "node:crypto";
import type { Anchor, Answer, Author, Message, Review, ReviewFile, Thread, ThreadKind, Verdict } from "./schema.js";

export type ReviewErrorCode = "not-found" | "invalid";

export class ReviewOperationError extends Error {
  constructor(
    readonly code: ReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReviewOperationError";
  }
}

export interface Actor {
  author: Author;
  name: string;
}

export const CLAUDE_ACTOR: Actor = { author: "claude", name: "Claude" };

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const ID_LENGTH = 6;

function randomId(prefix: string): string {
  const bytes = randomBytes(ID_LENGTH);
  let id = "";
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `${prefix}-${id}`;
}

function takenIds(file: ReviewFile): Set<string> {
  const ids = new Set<string>();
  for (const review of file.reviews) ids.add(review.id);
  for (const thread of file.threads) {
    ids.add(thread.id);
    for (const message of thread.messages) ids.add(message.id);
  }
  return ids;
}

function newId(file: ReviewFile, prefix: string): string {
  const taken = takenIds(file);
  let id = randomId(prefix);
  while (taken.has(id)) id = randomId(prefix);
  return id;
}

export function draftReview(file: ReviewFile): Review | null {
  return file.reviews.find((review) => review.state === "draft") ?? null;
}

export function isDraftThread(file: ReviewFile, thread: Thread): boolean {
  return draftReview(file)?.id === thread.reviewId;
}

export function isDraftMessage(file: ReviewFile, message: Message): boolean {
  const draft = draftReview(file);
  return draft !== null && message.reviewId === draft.id;
}

function withDraftReview(file: ReviewFile, actor: Actor, now: string): { file: ReviewFile; review: Review } {
  const existing = draftReview(file);
  if (existing) return { file, review: existing };
  const review: Review = {
    id: newId(file, "r"),
    state: "draft",
    verdict: null,
    body: "",
    author: actor.name,
    createdAt: now,
    submittedAt: null,
    addressedAt: null,
  };
  return { file: { ...file, reviews: [...file.reviews, review] }, review };
}

function findThread(file: ReviewFile, threadId: string): Thread {
  const thread = file.threads.find((candidate) => candidate.id === threadId);
  if (!thread) throw new ReviewOperationError("not-found", `No thread with id ${threadId}`);
  return thread;
}

function replaceThread(file: ReviewFile, updated: Thread): ReviewFile {
  return { ...file, threads: file.threads.map((thread) => (thread.id === updated.id ? updated : thread)) };
}

function requireText(value: string, what: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ReviewOperationError("invalid", `${what} can't be empty`);
  return trimmed;
}

export interface NewThreadInput {
  kind: ThreadKind;
  anchor: Anchor;
  body: string;
  suggestion: string | null;
}

export function addThread(file: ReviewFile, input: NewThreadInput, actor: Actor, now: string): ReviewFile {
  if (input.kind === "suggestion" && input.suggestion === null) {
    throw new ReviewOperationError("invalid", "A suggestion needs replacement text");
  }
  if (input.kind === "suggestion" && input.suggestion === input.anchor.quote) {
    throw new ReviewOperationError("invalid", "The suggestion doesn't change anything");
  }
  const body = input.body.trim();
  if (input.kind === "comment") requireText(body, "A comment");
  const { file: withReview, review } = withDraftReview(file, actor, now);
  const messages: Message[] = body
    ? [{ id: newId(withReview, "m"), author: actor.author, name: actor.name, at: now, body, reviewId: review.id }]
    : [];
  const thread: Thread = {
    id: newId(withReview, "t"),
    reviewId: review.id,
    kind: input.kind,
    anchor: input.anchor,
    suggestion: input.kind === "suggestion" ? input.suggestion : null,
    status: "open",
    createdAt: now,
    resolvedAt: null,
    resolvedBy: null,
    messages,
  };
  return { ...withReview, threads: [...withReview.threads, thread] };
}

function requireDraftThread(file: ReviewFile, threadId: string): Thread {
  const thread = findThread(file, threadId);
  if (!isDraftThread(file, thread)) {
    throw new ReviewOperationError("invalid", "Only draft comments can be edited or deleted");
  }
  return thread;
}

export interface ThreadEdit {
  body: string;
  suggestion: string | null;
}

export function editDraftThread(
  file: ReviewFile,
  threadId: string,
  edit: ThreadEdit,
  actor: Actor,
  now: string,
): ReviewFile {
  const thread = requireDraftThread(file, threadId);
  const body = edit.body.trim();
  if (thread.kind === "comment") requireText(body, "A comment");
  if (thread.kind === "suggestion" && edit.suggestion === null) {
    throw new ReviewOperationError("invalid", "A suggestion needs replacement text");
  }
  const [first, ...rest] = thread.messages;
  let messages: Message[];
  if (first && body) messages = [{ ...first, body, at: now }, ...rest];
  else if (first) messages = rest;
  else if (body) {
    messages = [
      { id: newId(file, "m"), author: actor.author, name: actor.name, at: now, body, reviewId: thread.reviewId },
    ];
  } else messages = [];
  return replaceThread(file, {
    ...thread,
    messages,
    suggestion: thread.kind === "suggestion" ? edit.suggestion : null,
  });
}

export function deleteDraftThread(file: ReviewFile, threadId: string): ReviewFile {
  requireDraftThread(file, threadId);
  return { ...file, threads: file.threads.filter((thread) => thread.id !== threadId) };
}

export function addReply(file: ReviewFile, threadId: string, body: string, actor: Actor, now: string): ReviewFile {
  const text = requireText(body, "A reply");
  findThread(file, threadId);
  const { file: withReview, review } =
    actor.author === "human" ? withDraftReview(file, actor, now) : { file, review: null };
  const thread = findThread(withReview, threadId);
  const message: Message = {
    id: newId(withReview, "m"),
    author: actor.author,
    name: actor.name,
    at: now,
    body: text,
    reviewId: review?.id ?? null,
  };
  return replaceThread(withReview, { ...thread, messages: [...thread.messages, message] });
}

export function deleteDraftMessage(file: ReviewFile, messageId: string): ReviewFile {
  const thread = file.threads.find((candidate) => candidate.messages.some((message) => message.id === messageId));
  const message = thread?.messages.find((candidate) => candidate.id === messageId);
  if (!thread || !message) throw new ReviewOperationError("not-found", `No message with id ${messageId}`);
  if (!isDraftMessage(file, message) || isDraftThread(file, thread)) {
    throw new ReviewOperationError("invalid", "Only draft replies can be deleted");
  }
  return replaceThread(file, {
    ...thread,
    messages: thread.messages.filter((candidate) => candidate.id !== messageId),
  });
}

export function setThreadResolved(
  file: ReviewFile,
  threadId: string,
  resolved: boolean,
  actor: Actor,
  now: string,
): ReviewFile {
  const thread = findThread(file, threadId);
  if (resolved) {
    return replaceThread(file, { ...thread, status: "resolved", resolvedAt: now, resolvedBy: actor.author });
  }
  return replaceThread(file, { ...thread, status: "open", resolvedAt: null, resolvedBy: null });
}

export function appendSystemMessage(file: ReviewFile, threadId: string, body: string, actor: Actor, now: string) {
  const thread = findThread(file, threadId);
  const message: Message = {
    id: newId(file, "m"),
    author: actor.author,
    name: actor.name,
    at: now,
    body,
    reviewId: null,
  };
  return replaceThread(file, { ...thread, messages: [...thread.messages, message] });
}

export interface AnswerInput {
  questionId: string;
  prompt: string;
  choice: number | null;
  choiceText: string | null;
  note: string;
}

export function upsertDraftAnswer(file: ReviewFile, input: AnswerInput, actor: Actor, now: string): ReviewFile {
  const note = input.note.trim();
  const isEmpty = input.choice === null && note === "";
  const draft = draftReview(file);
  const withoutDraft = file.answers.filter(
    (answer) => !(answer.questionId === input.questionId && draft && answer.reviewId === draft.id),
  );
  if (isEmpty) return { ...file, answers: withoutDraft };
  const { file: withReview, review } = withDraftReview(file, actor, now);
  const answer: Answer = {
    questionId: input.questionId,
    reviewId: review.id,
    prompt: input.prompt,
    choice: input.choice,
    choiceText: input.choice === null ? null : input.choiceText,
    note,
    at: now,
    ack: null,
  };
  return { ...withReview, answers: [...withoutDraft, answer] };
}

export function submitReview(file: ReviewFile, verdict: Verdict, body: string, actor: Actor, now: string): ReviewFile {
  const { file: withReview, review } = withDraftReview(file, actor, now);
  const submitted: Review = { ...review, state: "submitted", verdict, body: body.trim(), submittedAt: now };
  return { ...withReview, reviews: withReview.reviews.map((entry) => (entry.id === review.id ? submitted : entry)) };
}

export function unaddressedReviews(file: ReviewFile): Review[] {
  return file.reviews.filter((review) => review.state === "submitted");
}

export function markAddressed(file: ReviewFile, now: string): ReviewFile {
  if (unaddressedReviews(file).length === 0) {
    throw new ReviewOperationError("invalid", "There is no submitted review waiting to be addressed");
  }
  return {
    ...file,
    reviews: file.reviews.map((review) =>
      review.state === "submitted" ? { ...review, state: "addressed", addressedAt: now } : review,
    ),
  };
}

function isSubmittedReview(file: ReviewFile, reviewId: string): boolean {
  return file.reviews.some((review) => review.id === reviewId && review.state !== "draft");
}

export function acknowledgeAnswer(file: ReviewFile, questionId: string, message: string, now: string): ReviewFile {
  const index = file.answers.findLastIndex(
    (answer) => answer.questionId === questionId && isSubmittedReview(file, answer.reviewId),
  );
  const answer = file.answers[index];
  if (!answer) throw new ReviewOperationError("not-found", `No submitted answer for question ${questionId}`);
  const acknowledged: Answer = { ...answer, ack: { at: now, message: message.trim() } };
  return { ...file, answers: file.answers.map((entry, position) => (position === index ? acknowledged : entry)) };
}
