import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  CLAUDE_ACTOR,
  CorruptReviewFileError,
  expandHome,
  type ReviewFile,
  ReviewOperationError,
  ReviewService,
  type TimthinkConfig,
} from "@timthink/server";
import { formatReviewReport, workToAddress } from "./reviewReport.js";
import { DocOutsideRootError, docRelativePath } from "./url.js";

export const NOTHING_TO_ADDRESS_EXIT_CODE = 2;

export const REVIEW_USAGE = `Usage: timthink review <command>

Commands:
  show <doc>                                  Print the submitted review waiting on <doc> (exit 2 if none)
  reply <doc> <thread-id> [message]           Reply as Claude (reads the message from stdin when omitted or "-")
  resolve <doc> <thread-id> [--message text]  Resolve a thread, optionally with a final reply
  answer-ack <doc> <question-id> [--message text]
                                              Acknowledge a question answer after updating the plan
  addressed <doc>                             Mark the submitted review(s) on <doc> as addressed
  list                                        List docs with submitted reviews that aren't addressed yet

<doc> may be absolute, ~-relative, or relative to docsRoot.`;

export interface ReviewIo {
  out: (text: string) => void;
  err: (text: string) => void;
  readStdin: () => Promise<string>;
  stdinIsTty: boolean;
}

export interface ReviewOptions {
  message?: string;
}

class UsageError extends Error {}

async function realpathOr(target: string): Promise<string> {
  return realpath(target).catch(() => target);
}

export async function resolveDocArgument(docsRoot: string, input: string): Promise<string> {
  const expanded = expandHome(input);
  try {
    return docRelativePath(docsRoot, expanded);
  } catch (error) {
    if (!(error instanceof DocOutsideRootError) || !path.isAbsolute(expanded)) throw error;
    return docRelativePath(await realpathOr(docsRoot), await realpathOr(expanded));
  }
}

function normaliseId(prefix: string, id: string, known: readonly string[]): string {
  if (known.includes(id)) return id;
  const prefixed = `${prefix}-${id}`;
  return known.includes(prefixed) ? prefixed : id;
}

async function messageFrom(args: readonly string[], io: ReviewIo): Promise<string> {
  const joined = args.join(" ").trim();
  if (joined && joined !== "-") return joined;
  if (io.stdinIsTty) throw new UsageError("Give the message as an argument, or pipe it on stdin");
  const text = (await io.readStdin()).trim();
  if (!text) throw new UsageError("The message is empty");
  return text;
}

function relativeAge(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function listLine(docPath: string, review: ReviewFile): string | null {
  const work = workToAddress(review);
  const latest = work.reviews.at(-1);
  if (!latest) return null;
  const verdict = latest.verdict?.replace("_", " ") ?? "comment";
  const counts = [`${work.threads.length} open thread(s)`];
  if (work.outdated.length > 0) counts.push(`${work.outdated.length} outdated`);
  if (work.answers.length > 0) counts.push(`${work.answers.length} answer(s)`);
  return `${docPath}\t${verdict}\tsubmitted ${relativeAge(latest.submittedAt)}\t${counts.join(", ")}`;
}

async function list(service: ReviewService, io: ReviewIo): Promise<number> {
  const lines: string[] = [];
  for (const docPath of await service.store.docsWithReviews()) {
    try {
      const line = listLine(docPath, await service.store.read(docPath));
      if (line) lines.push(line);
    } catch (error) {
      if (!(error instanceof CorruptReviewFileError)) throw error;
      io.err(`Skipping ${docPath}: ${error.message}`);
    }
  }
  io.out(lines.length > 0 ? lines.join("\n") : "No submitted reviews are waiting.");
  return 0;
}

async function show(service: ReviewService, docPath: string, io: ReviewIo): Promise<number> {
  const [doc, review] = await Promise.all([service.readDoc(docPath), service.state(docPath)]);
  const report = formatReviewReport({ docPath, absolutePath: doc.absolute, raw: doc.raw, review });
  if (report === null) {
    io.out(`Nothing to address: no submitted review is waiting on ${docPath}.`);
    return NOTHING_TO_ADDRESS_EXIT_CODE;
  }
  io.out(report.trimEnd());
  return 0;
}

function requireArgs(args: readonly string[], count: number, usage: string): void {
  if (args.length < count) throw new UsageError(`Usage: timthink review ${usage}`);
}

async function runSubcommand(
  service: ReviewService,
  docsRoot: string,
  [subcommand, ...args]: readonly string[],
  options: ReviewOptions,
  io: ReviewIo,
): Promise<number> {
  if (subcommand === "list") return list(service, io);
  const docArg = args[0];
  if (!subcommand || !docArg) throw new UsageError(REVIEW_USAGE);
  const docPath = await resolveDocArgument(docsRoot, docArg);
  const state = () => service.state(docPath);
  switch (subcommand) {
    case "show":
      return show(service, docPath, io);
    case "reply": {
      requireArgs(args, 2, "reply <doc> <thread-id> [message]");
      const threadId = normaliseId(
        "t",
        args[1] ?? "",
        (await state()).threads.map((thread) => thread.id),
      );
      await service.reply(docPath, null, threadId, await messageFrom(args.slice(2), io), CLAUDE_ACTOR);
      io.out(`Replied on ${threadId}.`);
      return 0;
    }
    case "resolve": {
      requireArgs(args, 2, "resolve <doc> <thread-id> [--message text]");
      const threadId = normaliseId(
        "t",
        args[1] ?? "",
        (await state()).threads.map((thread) => thread.id),
      );
      const message = options.message ?? (args.length > 2 ? args.slice(2).join(" ") : undefined);
      await service.setResolved(docPath, null, threadId, true, { actor: CLAUDE_ACTOR, message });
      io.out(`Resolved ${threadId}.`);
      return 0;
    }
    case "answer-ack": {
      requireArgs(args, 2, "answer-ack <doc> <question-id> [--message text]");
      const questionId = args[1] ?? "";
      await service.acknowledgeAnswer(docPath, questionId, options.message ?? args.slice(2).join(" "));
      io.out(`Acknowledged the answer to ${questionId}.`);
      return 0;
    }
    case "addressed": {
      const view = await service.markAddressed(docPath);
      const remaining = view.threads.filter((thread) => thread.status === "open").length;
      io.out(`Marked the review on ${docPath} as addressed (${remaining} thread(s) left open).`);
      return 0;
    }
    default:
      throw new UsageError(`Unknown review command: ${subcommand}\n\n${REVIEW_USAGE}`);
  }
}

export async function runReview(
  config: Pick<TimthinkConfig, "docsRoot" | "userName">,
  args: readonly string[],
  options: ReviewOptions,
  io: ReviewIo,
): Promise<number> {
  const service = new ReviewService({ docsRoot: config.docsRoot, userName: config.userName });
  try {
    return await runSubcommand(service, config.docsRoot, args, options, io);
  } catch (error) {
    if (error instanceof UsageError || error instanceof ReviewOperationError || error instanceof DocOutsideRootError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}
