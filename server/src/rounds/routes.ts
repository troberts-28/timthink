import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { runGit } from "../code/git.js";
import type { SessionView } from "../sessions/types.js";
import { isExistingDirectory } from "../sessions/warp.js";
import { abandonRound, decideRoundItem, RoundError, submitRound } from "./operations.js";
import type { RoundStore } from "./roundStore.js";
import { hasLiveWaiter, type RoundView, roundResumePrompt, summarizeRound } from "./roundView.js";
import { ROUND_ID_PATTERN, type Round, roundDecisionSchema } from "./schema.js";

export interface RoundRouteDeps {
  rounds: RoundStore;
  sessionFor: (round: Round) => Promise<SessionView | null>;
  hostCheckout: (repo: string) => string;
}

export type RoundFileContext =
  | { status: "ok"; path: string; startLine: number; lines: string[]; line: number }
  | { status: "unavailable"; message: string };

const CONTEXT_LINES_AROUND = 10;

const roundId = z.string().regex(ROUND_ID_PATTERN);
const idQuery = z.object({ id: roundId });
const idBody = z.object({ id: roundId });
const decisionBody = z.object({ id: roundId, itemId: z.string().min(1).max(64), decision: roundDecisionSchema });
const fileQuery = z.object({ id: roundId, item: z.string().min(1).max(64) });

export function roundRoutes(deps: RoundRouteDeps) {
  const view = async (round: Round): Promise<RoundView> => ({
    round,
    waiting: hasLiveWaiter(round),
    session: await deps.sessionFor(round),
    resumePrompt: roundResumePrompt(round),
  });

  return new Hono()
    .get("/", zValidator("query", idQuery), (c) =>
      attempt(c, async () => view(await deps.rounds.read(c.req.valid("query").id))),
    )
    .get("/list", async (c) => c.json({ rounds: (await deps.rounds.list()).map(summarizeRound) }))
    .post("/decision", zValidator("json", decisionBody), (c) => {
      const { id, itemId, decision } = c.req.valid("json");
      return attempt(c, async () =>
        view(await deps.rounds.update(id, (round) => decideRoundItem(round, itemId, decision))),
      );
    })
    .post("/submit", zValidator("json", idBody), (c) =>
      attempt(c, async () =>
        view(await deps.rounds.update(c.req.valid("json").id, (round) => submitRound(round, new Date().toISOString()))),
      ),
    )
    .post("/abandon", zValidator("json", idBody), (c) =>
      attempt(c, async () => view(await deps.rounds.update(c.req.valid("json").id, abandonRound))),
    )
    .get("/file", zValidator("query", fileQuery), (c) => {
      const { id, item } = c.req.valid("query");
      return attempt(c, async () => fileContext(deps, await deps.rounds.read(id), item));
    });
}

async function fileContext(deps: RoundRouteDeps, round: Round, itemId: string): Promise<RoundFileContext> {
  const item = round.items.find((candidate) => candidate.id === itemId);
  const headSha = round.prs.find((pr) => pr.number === item?.pr)?.headSha;
  if (!item?.path || !item.line || !headSha) {
    return { status: "unavailable", message: "This comment isn't on a line" };
  }
  for (const checkout of [round.cwd, deps.hostCheckout(round.repo)]) {
    if (!checkout || !(await isExistingDirectory(checkout))) {
      continue;
    }
    const contents = await runGit(checkout, ["show", `${headSha}:${item.path}`]);
    if (contents === null) {
      continue;
    }
    const lines = contents.split("\n");
    const startLine = Math.max(1, item.line - CONTEXT_LINES_AROUND);
    const endLine = Math.min(lines.length, item.line + CONTEXT_LINES_AROUND);
    return { status: "ok", path: item.path, startLine, lines: lines.slice(startLine - 1, endLine), line: item.line };
  }
  return { status: "unavailable", message: `${headSha.slice(0, 7)} isn't in a local checkout of ${round.repo}` };
}

async function attempt<T>(c: Context, work: () => Promise<T>) {
  try {
    return c.json(await work());
  } catch (error) {
    if (error instanceof RoundError) {
      const status = error.code === "not-found" ? 404 : error.code === "conflict" ? 409 : 422;
      return c.json({ error: error.code, message: error.message }, status);
    }
    throw error;
  }
}
