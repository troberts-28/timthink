import type { SessionActionResponse, SessionView } from "@timthink/server";
import { focusSession, type ResumeWith, resumeSession } from "../api/client";

export type HandOffOutcome =
  | { kind: "focused"; command: string; copied: boolean }
  | { kind: "resumed"; command: string; copied: boolean }
  | { kind: "possibly-open"; command: string; copied: boolean; title: string }
  | { kind: "copied-only"; command: string; copied: boolean; reason: string | null };

export function reviewCommand(docPath: string): string {
  return `/timthink review ${docPath}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function failureReason(result: SessionActionResponse): string | null {
  return result.status === "unavailable" || result.status === "error" ? result.message : null;
}

export async function handOffCommand(
  command: string,
  session: SessionView | null,
  resumeWith: ResumeWith,
): Promise<HandOffOutcome> {
  const copied = await copyText(command);
  if (!session) return { kind: "copied-only", command, copied, reason: null };
  try {
    if (session.live && session.warpFocusUrl) {
      const result = await focusSession(session.id);
      if (result.status === "focused") return { kind: "focused", command, copied };
      return { kind: "copied-only", command, copied, reason: failureReason(result) };
    }
    if (session.mayBeOpenUntracked) return { kind: "possibly-open", command, copied, title: session.title };
    if (session.canResume) {
      const result = await resumeSession(session.id, resumeWith);
      if (result.status === "resumed") return { kind: "resumed", command, copied };
      return { kind: "copied-only", command, copied, reason: failureReason(result) };
    }
    return { kind: "copied-only", command, copied, reason: null };
  } catch (error) {
    return { kind: "copied-only", command, copied, reason: error instanceof Error ? error.message : null };
  }
}

export function handOffToClaude(docPath: string, session: SessionView | null): Promise<HandOffOutcome> {
  return handOffCommand(reviewCommand(docPath), session, { reviewDoc: docPath });
}
