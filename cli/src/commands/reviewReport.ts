import {
  type Answer,
  lineNumberAt,
  type Message,
  type Review,
  type ReviewFile,
  type ReviewView,
  type Thread,
} from "@timthink/server";

const VERDICT_LABELS: Record<NonNullable<Review["verdict"]>, string> = {
  approve: "Approve",
  request_changes: "Request changes",
  comment: "Comment",
};

export interface ReportInput {
  docPath: string;
  absolutePath: string;
  raw: string;
  review: ReviewView;
}

export interface WorkItems {
  reviews: Review[];
  threads: Thread[];
  outdated: Thread[];
  answers: Answer[];
}

function submittedIn(reviewIds: ReadonlySet<string>, thread: Thread): boolean {
  return reviewIds.has(thread.reviewId) || thread.messages.some((message) => reviewIds.has(message.reviewId ?? ""));
}

export function workToAddress(review: ReviewFile): WorkItems {
  const reviews = review.reviews.filter((entry) => entry.state === "submitted");
  const ids = new Set(reviews.map((entry) => entry.id));
  const relevant = review.threads
    .filter((thread) => thread.status !== "resolved" && submittedIn(ids, thread))
    .sort((a, b) => a.anchor.start - b.anchor.start);
  return {
    reviews,
    threads: relevant.filter((thread) => thread.status === "open"),
    outdated: relevant.filter((thread) => thread.status === "outdated"),
    answers: review.answers.filter((answer) => ids.has(answer.reviewId) && answer.ack === null),
  };
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
}

function fenced(text: string, lang = "markdown"): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}${lang}\n${text}\n${fence}`;
}

function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

function lineLabel(raw: string, thread: Thread): string {
  const first = lineNumberAt(raw, thread.anchor.start);
  const last = lineNumberAt(raw, Math.max(thread.anchor.start, thread.anchor.end - 1));
  return first === last ? `Line ${first}` : `Lines ${first}–${last}`;
}

function sectionLabel(thread: Thread): string {
  return thread.anchor.headingPath.length > 0 ? thread.anchor.headingPath.join(" › ") : "(before the first heading)";
}

function isSubmittedMessage(review: ReviewView, message: Message): boolean {
  return message.reviewId === null || message.reviewId !== review.draftReviewId;
}

function messageLines(review: ReviewView, thread: Thread): string[] {
  return thread.messages
    .filter((message) => isSubmittedMessage(review, message))
    .map((message) => {
      const who = message.author === "claude" ? "Claude (you)" : message.name || "Reviewer";
      return `**${who}:** ${message.body}`;
    });
}

function threadSection(review: ReviewView, raw: string, thread: Thread, outdated: boolean): string {
  const parts = [`### Thread \`${thread.id}\` · ${thread.kind}`, "", `Section: ${sectionLabel(thread)}`];
  if (outdated) {
    parts.push("The commented passage is no longer in the plan. Original quote:");
  } else {
    parts.push(`${lineLabel(raw, thread)}:`);
  }
  parts.push("", blockquote(thread.anchor.quote), "");
  if (thread.kind === "suggestion" && thread.suggestion !== null) {
    parts.push("Suggested replacement for the quoted passage:", "", fenced(thread.suggestion), "");
  }
  const messages = messageLines(review, thread);
  if (messages.length > 0) parts.push(...messages.flatMap((line) => [line, ""]));
  return parts.join("\n").trimEnd();
}

function answerSection(answer: Answer): string {
  const parts = [`### Question \`${answer.questionId}\``];
  if (answer.prompt) parts.push("", `Question: ${answer.prompt}`);
  if (answer.choiceText !== null) parts.push(`Chosen option: ${answer.choiceText}`);
  if (answer.note) parts.push(`Note: ${answer.note}`);
  return parts.join("\n");
}

function reviewHeading(entry: Review): string {
  const verdict = entry.verdict ? VERDICT_LABELS[entry.verdict] : "No verdict";
  const when = entry.submittedAt ? ` on ${entry.submittedAt.slice(0, 16).replace("T", " ")} UTC` : "";
  const lines = [`## Verdict: ${verdict}`, "", `Review \`${entry.id}\`, submitted by ${entry.author}${when}.`];
  if (entry.body) lines.push("", "Overall comment:", "", blockquote(entry.body));
  return lines.join("\n");
}

function nextSteps(docPath: string): string {
  return [
    "## When you're done",
    "",
    `- Reply to every thread: \`timthink review reply ${docPath} <thread-id> "<what you changed, or why not>"\``,
    `- Resolve threads you fully addressed: \`timthink review resolve ${docPath} <thread-id>\``,
    `- Acknowledge each answer once it's in the plan: \`timthink review answer-ack ${docPath} <question-id> --message "…"\``,
    `- Then: \`timthink review addressed ${docPath}\``,
  ].join("\n");
}

export function formatReviewReport({ docPath, absolutePath, raw, review }: ReportInput): string | null {
  const work = workToAddress(review);
  if (work.reviews.length === 0) return null;
  const sections = [`# Review of ${docPath}`, `File: ${absolutePath}`];
  sections.push(...work.reviews.map(reviewHeading));
  if (work.threads.length > 0) {
    sections.push(`## Threads to address (${work.threads.length})`);
    sections.push(...work.threads.map((thread) => threadSection(review, raw, thread, false)));
  } else {
    sections.push("## Threads to address\n\nNo open threads.");
  }
  if (work.outdated.length > 0) {
    sections.push(`## Outdated threads (${work.outdated.length})`);
    sections.push(...work.outdated.map((thread) => threadSection(review, raw, thread, true)));
  }
  if (work.answers.length > 0) {
    sections.push(`## Answers to open questions (${work.answers.length})`);
    sections.push(...work.answers.map(answerSection));
  }
  sections.push(nextSteps(docPath));
  return `${sections.join("\n\n")}\n`;
}
