import type { BuildRequest, SessionView } from "@timthink/server";
import { buildShellCommand, buildSlashCommand } from "@timthink/server/shared";
import { focusSession } from "../api/client";
import { copyText, type HandOffOutcome, handOffCommand } from "../review/handOff";

export const NEW_SESSION = "new";
export const NOT_NOW = "not-now";

export type BuildTargetKind = "new" | "planner" | "not-now";

export type BuildOutcome =
  | { kind: "new-session"; command: string; copied: boolean; focused: boolean; problem: string | null }
  | { kind: "planner"; handOff: HandOffOutcome }
  | { kind: "skipped" };

function liveFirst(a: SessionView, b: SessionView): number {
  const score = (session: SessionView) => (session.live && session.warpFocusUrl ? 0 : 1);
  return score(a) - score(b);
}

export function plannerOf(sessions: readonly SessionView[]): SessionView | null {
  const planned = sessions.filter((session) => session.plannedDoc);
  const pool = planned.length > 0 ? planned : sessions.filter((session) => session.wroteDoc && !session.builtDoc);
  return [...pool].sort(liveFirst)[0] ?? null;
}

export function targetFor(kind: BuildTargetKind, sessions: readonly SessionView[], allowNotNow: boolean): string {
  if (kind === "not-now" && allowNotNow) return NOT_NOW;
  if (kind === "planner") return plannerOf(sessions)?.id ?? NEW_SESSION;
  return NEW_SESSION;
}

export function kindOf(target: string): BuildTargetKind {
  if (target === NEW_SESSION) return "new";
  if (target === NOT_NOW) return "not-now";
  return "planner";
}

export function newSessionCommand(request: BuildRequest, sessions: readonly SessionView[]): string {
  return buildShellCommand(request, plannerOf(sessions)?.cwd ?? null);
}

async function startNewSession(request: BuildRequest, sessions: readonly SessionView[]): Promise<BuildOutcome> {
  const planner = plannerOf(sessions);
  const command = newSessionCommand(request, sessions);
  const copied = await copyText(command);
  if (!planner?.live || !planner.warpFocusUrl) {
    return { kind: "new-session", command, copied, focused: false, problem: null };
  }
  try {
    const result = await focusSession(planner.id);
    const problem = result.status === "unavailable" || result.status === "error" ? result.message : null;
    return { kind: "new-session", command, copied, focused: result.status === "focused", problem };
  } catch (error) {
    const problem = error instanceof Error ? error.message : "Couldn't reach Warp";
    return { kind: "new-session", command, copied, focused: false, problem };
  }
}

export async function handOffBuild(
  target: string,
  request: BuildRequest,
  sessions: readonly SessionView[],
): Promise<BuildOutcome> {
  if (target === NOT_NOW) return { kind: "skipped" };
  if (target === NEW_SESSION) return startNewSession(request, sessions);
  const session = sessions.find((candidate) => candidate.id === target) ?? null;
  return { kind: "planner", handOff: await handOffCommand(buildSlashCommand(request), session, { build: request }) };
}
