import type { SessionView } from "../sessions/types.js";
import type { Round, RoundKind, RoundState } from "./schema.js";

export interface RoundSummary {
  id: string;
  kind: RoundKind;
  title: string;
  repo: string;
  project: string | null;
  prs: Array<{ number: number; link: string }>;
  state: RoundState;
  createdAt: string;
  submittedAt: string | null;
  itemCount: number;
  decidedCount: number;
  reportedCount: number;
  waiting: boolean;
}

export interface RoundView {
  round: Round;
  waiting: boolean;
  session: SessionView | null;
  resumePrompt: string;
  canUndo: boolean;
}

export function summarizeRound(round: Round): RoundSummary {
  return {
    id: round.id,
    kind: round.kind,
    title: round.title,
    repo: round.repo,
    project: round.project,
    prs: round.kind === "pr-comments" ? round.prs.map(({ number, link }) => ({ number, link })) : [],
    state: round.state,
    createdAt: round.createdAt,
    submittedAt: round.submittedAt,
    itemCount: round.items.length,
    decidedCount: round.items.filter((item) => round.decisions[item.id]).length,
    reportedCount: round.items.filter((item) => round.outcomes[item.id]).length,
    waiting: hasLiveWaiter(round),
  };
}

export function roundResumePrompt(round: Pick<Round, "id">) {
  return `/timthink comments --round ${round.id}`;
}

export function awaitsSession(round: Round) {
  return round.kind === "pr-comments";
}

export function hasLiveWaiter(round: Round) {
  return round.waiter !== null && isProcessAlive(round.waiter.pid);
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}
