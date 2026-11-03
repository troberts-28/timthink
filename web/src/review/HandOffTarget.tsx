import type { SessionView } from "@timthink/server";
import { Copy } from "lucide-react";
import { relativeTime } from "../lib/format";

export const COPY_ONLY = "copy-only";
const MAX_SESSIONS = 4;

export function defaultHandOffTarget(sessions: readonly SessionView[]): string {
  const best =
    sessions.find((session) => session.live && session.warpFocusUrl) ??
    sessions.find((session) => session.wroteDoc) ??
    sessions[0];
  return best?.id ?? COPY_ONLY;
}

export function handOffCandidates(sessions: readonly SessionView[], selectedId: string): SessionView[] {
  const shown = sessions.slice(0, MAX_SESSIONS);
  const selected = sessions.find((session) => session.id === selectedId);
  return selected && !shown.includes(selected) ? [...shown.slice(0, MAX_SESSIONS - 1), selected] : shown;
}

function directoryName(directory: string | null): string | null {
  return directory ? (directory.split("/").filter(Boolean).pop() ?? directory) : null;
}

function whatHappens(session: SessionView): string {
  if (session.live && session.warpFocusUrl) return "Jumps to its tab";
  if (session.mayBeOpenUntracked) return "May already be open in a tab timthink can't see";
  if (session.canResume) return "Resumes in a new tab and starts the review";
  return "Can't be opened";
}

function TargetOption({
  session,
  checked,
  onSelect,
}: {
  session: SessionView;
  checked: boolean;
  onSelect: () => void;
}) {
  const where = [
    directoryName(session.cwd),
    session.lastActivity ? relativeTime(Date.parse(session.lastActivity)) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <label className={`handoff-option ${checked ? "is-checked" : ""}`}>
      <input type="radio" name="handoff-target" checked={checked} onChange={onSelect} className="sr-only" />
      <span className="flex min-w-0 items-center gap-2">
        {session.live ? <span className="size-1.5 flex-none rounded-full bg-ok" title="Live" aria-hidden /> : null}
        <span className="truncate text-ui font-medium text-ink">{session.title}</span>
        {session.plannedDoc ? <span className="handoff-tag">Planned</span> : null}
        {session.builtDoc ? <span className="handoff-tag">Built</span> : null}
        {session.wroteDoc && !session.plannedDoc && !session.builtDoc ? (
          <span className="handoff-tag">Wrote this plan</span>
        ) : null}
      </span>
      <span className="flex min-w-0 items-center justify-between gap-3 text-meta text-ink-64">
        <span className="truncate">{whatHappens(session)}</span>
        <span className="flex-none text-ink-32 tabular-nums">{where}</span>
      </span>
    </label>
  );
}

export function HandOffTarget({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: readonly SessionView[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
      <legend className="mb-2 p-0 text-meta font-semibold text-ink-64">Send to</legend>
      {handOffCandidates(sessions, selectedId).map((session) => (
        <TargetOption
          key={session.id}
          session={session}
          checked={selectedId === session.id}
          onSelect={() => onSelect(session.id)}
        />
      ))}
      <label className={`handoff-option ${selectedId === COPY_ONLY ? "is-checked" : ""}`}>
        <input
          type="radio"
          name="handoff-target"
          checked={selectedId === COPY_ONLY}
          onChange={() => onSelect(COPY_ONLY)}
          className="sr-only"
        />
        <span className="flex items-center gap-2 text-ui font-medium text-ink">
          <Copy className="size-3.5 text-ink-64" aria-hidden />
          Just copy the command
        </span>
        <span className="text-meta text-ink-64">Paste it into any Claude session yourself</span>
      </label>
    </fieldset>
  );
}
