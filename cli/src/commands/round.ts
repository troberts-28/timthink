import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  abandonRound,
  BIND_HOST,
  DocsStore,
  OUTCOME_KINDS,
  ProjectRegistry,
  type Round,
  RoundError,
  type RoundItem,
  RoundStore,
  reportRoundOutcomes,
  roundOutcomesSchema,
  setRoundWaiter,
  summarizeRound,
  type TimthinkConfig,
} from "@timthink/server";
import { findDocsDir, gitToplevel } from "./docsDir.js";

export const ROUND_ABANDONED_EXIT_CODE = 3;

export const ROUND_USAGE = `Usage: timthink round <command>

Commands:
  create <file|->          Create a round from JSON (a file, or stdin with "-") and print its id and URL
  wait <id>                Wait until the round is submitted, then print the decisions as JSON
                           (exit 0 once submitted, ${ROUND_ABANDONED_EXIT_CODE} if abandoned). Run it in the background.
  show <id>                Print the round's state, and its decisions once submitted
  report <id> <file|->     Record outcomes as JSON { "<item-id>": { "kind": "…", "note": "…", "commit": "…" } }
                           (kind: ${OUTCOME_KINDS.join(", ")}); the round is done once every item has one
  abandon <id>             Abandon the round, which ends any wait with exit ${ROUND_ABANDONED_EXIT_CODE}
  list                     List rounds, newest first`;

export interface RoundIo {
  out: (text: string) => void;
  err: (text: string) => void;
  readStdin: () => Promise<string>;
}

export interface RoundCommand {
  config: TimthinkConfig;
  args: readonly string[];
  io: RoundIo;
  cwd: string;
}

class UsageError extends Error {}

export async function runRound({ config, args, io, cwd }: RoundCommand): Promise<number> {
  const [subcommand, id, source] = args;
  const store = new RoundStore(config.stateDir);
  try {
    if (subcommand === "list") {
      io.out(listRounds(await store.list()));
      return 0;
    }
    if (!subcommand || !id) {
      throw new UsageError(ROUND_USAGE);
    }
    switch (subcommand) {
      case "create":
        return await createRound({ config, store, source: id, io, cwd });
      case "wait":
        return await waitForRound(store, id, io);
      case "show":
        io.out(describeRound(await store.read(id)));
        return 0;
      case "report":
        return await reportOutcomes({ store, id, source, io });
      case "abandon":
        await store.update(id, abandonRound);
        io.out(`Abandoned ${id}.`);
        return 0;
      default:
        throw new UsageError(`Unknown round command: ${subcommand}\n\n${ROUND_USAGE}`);
    }
  } catch (error) {
    if (error instanceof UsageError || error instanceof RoundError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}

export function roundUrl(config: Pick<TimthinkConfig, "port">, id: string) {
  return `http://${BIND_HOST}:${config.port}/round/${encodeURIComponent(id)}`;
}

async function createRound({
  config,
  store,
  source,
  io,
  cwd,
}: {
  config: TimthinkConfig;
  store: RoundStore;
  source: string;
  io: RoundIo;
  cwd: string;
}) {
  const input = parseJson(await readSource(source, io));
  const checkout = (await gitToplevel(cwd)) ?? path.resolve(cwd);
  const repo = path.basename((await findDocsDir(config, checkout)).dir);
  const round = await store.create({
    input,
    repo,
    project: null,
    cwd: checkout,
    now: new Date().toISOString(),
  });
  const project = await projectForPrs(config, round);
  const created = project ? await store.update(round.id, (current) => ({ ...current, project })) : round;
  io.out(
    [
      `Created ${created.id} with ${created.items.length} item(s)${project ? ` in ${project}` : ""}.`,
      roundUrl(config, created.id),
      `Wait for the decisions in the background: timthink round wait ${created.id}`,
    ].join("\n"),
  );
  return 0;
}

async function waitForRound(store: RoundStore, id: string, io: RoundIo) {
  const current = await store.read(id);
  const settled = current.state === "open" ? await waitWhileOpen(store, id) : current;
  if (settled.state === "abandoned") {
    io.err(`${id} was abandoned.`);
    return ROUND_ABANDONED_EXIT_CODE;
  }
  io.out(JSON.stringify(decisionsReport(settled), null, 2));
  return 0;
}

async function waitWhileOpen(store: RoundStore, id: string) {
  await store.update(id, (round) => setRoundWaiter(round, { pid: process.pid, since: new Date().toISOString() }));
  try {
    return await untilNotOpen(store, id);
  } finally {
    await store
      .update(id, (round) => (round.waiter?.pid === process.pid ? setRoundWaiter(round, null) : round))
      .catch(() => {});
  }
}

function untilNotOpen(store: RoundStore, id: string) {
  return new Promise<Round>((resolve, reject) => {
    const fileName = `${id}.json`;
    let settled = false;
    const watcher = watch(store.dir, (_event, changed) => {
      if (changed?.toString() === fileName) {
        void check();
      }
    });
    const finish = (outcome: () => void) => {
      if (!settled) {
        settled = true;
        watcher.close();
        outcome();
      }
    };
    const check = async () => {
      const round = await store.find(id);
      if (round && round.state !== "open") {
        finish(() => resolve(round));
      }
    };
    watcher.on("error", (error) => finish(() => reject(error)));
    void check();
  });
}

async function reportOutcomes({
  store,
  id,
  source,
  io,
}: {
  store: RoundStore;
  id: string;
  source: string | undefined;
  io: RoundIo;
}) {
  if (!source) {
    throw new UsageError("Usage: timthink round report <id> <file|->");
  }
  const parsed = roundOutcomesSchema.safeParse(parseJson(await readSource(source, io)));
  if (!parsed.success) {
    throw new UsageError(
      `Outcomes must map item ids to { kind, note, commit }: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  const round = await store.update(id, (current) => reportRoundOutcomes(current, parsed.data));
  const summary = summarizeRound(round);
  io.out(
    `Recorded ${Object.keys(parsed.data).length} outcome(s); ${summary.reportedCount}/${summary.itemCount} reported, ${round.state}.`,
  );
  return 0;
}

function decisionsReport(round: Round) {
  return {
    round: round.id,
    state: round.state,
    prs: round.prs,
    decisions: round.items.map((item) => decisionLine(round, item)),
  };
}

function decisionLine(round: Round, item: RoundItem) {
  const decision = round.decisions[item.id];
  const choice = decision?.choice;
  const option = choice?.kind === "option" ? item.options.find((candidate) => candidate.id === choice.optionId) : null;
  return {
    item: item.id,
    pr: item.pr,
    threadId: item.threadId,
    path: item.path,
    line: item.line,
    author: item.author,
    decision: option?.label ?? (choice?.kind === "other" ? "Other" : null),
    optionId: option?.id ?? null,
    customFix: choice?.kind === "other" ? choice.text : null,
    reply: decision?.reply ?? "",
  };
}

function describeRound(round: Round) {
  const summary = summarizeRound(round);
  const header = [
    `${round.id}: ${round.title}`,
    `State: ${round.state} · ${summary.decidedCount}/${summary.itemCount} decided · ${summary.reportedCount} reported${summary.waiting ? " · a session is waiting" : ""}`,
    `PRs: ${round.prs.map((pr) => `#${pr.number}`).join(", ")}`,
  ];
  if (round.state === "open") {
    return header.join("\n");
  }
  return [...header, "", JSON.stringify(decisionsReport(round), null, 2)].join("\n");
}

function listRounds(rounds: readonly Round[]) {
  if (rounds.length === 0) {
    return "No rounds yet.";
  }
  return rounds
    .map((round) => {
      const summary = summarizeRound(round);
      return `${round.id}\t${round.state}\t${summary.decidedCount}/${summary.itemCount} decided\t${round.title}`;
    })
    .join("\n");
}

async function projectForPrs(config: TimthinkConfig, round: Round) {
  const registry = new ProjectRegistry(config.docsRoot);
  await registry.scan();
  const store = new DocsStore(config.docsRoot, registry);
  await store.scanAll();
  const numbers = new Set(round.prs.map((pr) => String(pr.number)));
  const listsRoundPr = (repo: string, prs: readonly string[]) =>
    repo === round.repo && prs.some((number) => numbers.has(number));
  const match = registry.projects().find((record) => {
    const isExplicit = record.manifest.prs.some((ref) => listsRoundPr(ref.repo, [String(ref.number)]));
    const isInDoc = store.projectDocs(record.id).some((doc) => listsRoundPr(doc.codeRepo, doc.prs));
    return isExplicit || isInDoc;
  });
  return match?.id ?? null;
}

async function readSource(source: string, io: RoundIo) {
  return source === "-" ? io.readStdin() : readFile(source, "utf8");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError("The input isn't valid JSON");
  }
}
