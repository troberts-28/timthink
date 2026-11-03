import type { SessionActionResponse, SessionView } from "@timthink/server";
import { focusSession, resumeSession } from "../api/client";
import { useDocSessions } from "../api/queries";
import { useChanges } from "../changes/ChangesContext";
import { useKeyShortcut } from "../lib/shortcuts";
import { useToast } from "../lib/toast";
import { defaultHandOffTarget } from "../review/HandOffTarget";

function problemOf(result: SessionActionResponse): string | null {
  return result.status === "unavailable" || result.status === "error" ? result.message : null;
}

async function jumpToSession(session: SessionView): Promise<string | null> {
  if (session.live && session.warpFocusUrl) return problemOf(await focusSession(session.id));
  if (session.mayBeOpenUntracked) return `“${session.title}” may already be open in a tab timthink can't see`;
  if (!session.canResume) return "This plan's Claude session can't be reopened";
  return problemOf(await resumeSession(session.id));
}

export function PlanShortcuts({ docPath, raw }: { docPath: string; raw: string }) {
  const toast = useToast();
  const changes = useChanges();
  const { data: sessionsData } = useDocSessions(docPath);

  useKeyShortcut("y", () => {
    navigator.clipboard.writeText(raw).then(
      () => toast("Copied the markdown"),
      () => toast("Couldn't copy the plan to the clipboard", "bad"),
    );
  });

  useKeyShortcut("d", () => {
    if (!changes?.hasChanges) {
      toast("Nothing has changed since you last looked");
      return;
    }
    changes.setShowChanges(!changes.showChanges);
  });

  useKeyShortcut("w", () => {
    const sessions = sessionsData?.sessions ?? [];
    const target = sessions.find((session) => session.id === defaultHandOffTarget(sessions));
    if (!target) {
      toast("No Claude session is linked to this plan yet");
      return;
    }
    jumpToSession(target).then(
      (problem) => {
        if (problem) toast(problem, "bad");
      },
      (error: unknown) => toast(error instanceof Error ? error.message : "Couldn't reach Warp", "bad"),
    );
  });

  return null;
}
