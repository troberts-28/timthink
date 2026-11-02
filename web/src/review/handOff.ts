import type { SessionActionResponse } from "@timthink/server";
import { fetchDocSessions, focusSession, resumeSession } from "../api/client";

export type HandOffOutcome =
  | { kind: "focused"; command: string; copied: boolean }
  | { kind: "resumed"; command: string; copied: boolean }
  | { kind: "copied-only"; command: string; copied: boolean; reason: string | null };

export function reviewCommand(docPath: string): string {
  return `/timthink review ${docPath}`;
}

async function copy(text: string): Promise<boolean> {
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

export async function handOffToClaude(docPath: string): Promise<HandOffOutcome> {
  const command = reviewCommand(docPath);
  const copied = await copy(command);
  try {
    const [latest] = (await fetchDocSessions(docPath)).sessions;
    if (latest?.live && latest.warpFocusUrl) {
      const result = await focusSession(latest.id);
      if (result.status === "focused") return { kind: "focused", command, copied };
      return { kind: "copied-only", command, copied, reason: failureReason(result) };
    }
    if (latest?.canResume) {
      const result = await resumeSession(latest.id);
      if (result.status === "resumed") return { kind: "resumed", command, copied };
      return { kind: "copied-only", command, copied, reason: failureReason(result) };
    }
    return { kind: "copied-only", command, copied, reason: null };
  } catch (error) {
    return { kind: "copied-only", command, copied, reason: error instanceof Error ? error.message : null };
  }
}
