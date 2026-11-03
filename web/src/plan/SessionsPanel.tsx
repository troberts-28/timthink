import type { SessionActionResponse, SessionView } from "@timthink/server";
import {
  Check,
  ChevronDown,
  Copy,
  FolderGit2,
  GitBranch,
  LoaderCircle,
  Play,
  SquareTerminal,
  Terminal,
} from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { focusSession, resumeSession } from "../api/client";
import { useDocSessions } from "../api/queries";
import { relativeTime } from "../lib/format";
import { useToast } from "../lib/toast";
import { useDismiss } from "../lib/useDismiss";

const COPIED_FEEDBACK_MS = 1500;

function basename(directory: string): string {
  return directory.replace(/\/+$/, "").split("/").pop() || directory;
}

function resumeCommand(session: SessionView): string {
  return `claude --resume ${session.id}`;
}

function LiveDot({ className = "" }: { className?: string }) {
  return (
    <span className={`relative inline-flex size-2 flex-none ${className}`} aria-hidden>
      <span className="live-ping absolute inset-0 rounded-full bg-ok" />
      <span className="relative inline-flex size-2 rounded-full bg-ok" />
    </span>
  );
}

function ActionButton({
  tone,
  busy,
  icon,
  onClick,
  children,
}: {
  tone: "primary" | "secondary";
  busy: boolean;
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  const toneClass =
    tone === "primary"
      ? "bg-accent text-on-accent hover:brightness-[0.96] active:brightness-[0.92]"
      : "border border-line bg-surface text-ink hover:border-ink-32";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`flex h-8 items-center gap-1.5 rounded-button px-3 text-meta font-semibold transition-[filter,border-color] duration-150 disabled:cursor-progress disabled:opacity-70 ${toneClass}`}
    >
      {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

function CopyResumeButton({ session }: { session: SessionView }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(resumeCommand(session));
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
      toast(
        <>
          Copied <code className="font-mono text-[12.5px]">{resumeCommand(session)}</code>
        </>,
      );
    } catch {
      toast("Couldn't copy to the clipboard", "bad");
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={`Copy “${resumeCommand(session)}”`}
      aria-label="Copy resume command"
      className="ml-auto grid size-8 flex-none place-items-center rounded-button text-ink-64 transition-colors duration-150 hover:bg-bg-sunken hover:text-ink"
    >
      {copied ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

type PendingAction = "focus" | "resume" | null;

function useSessionAction(session: SessionView) {
  const toast = useToast();
  const [pending, setPending] = useState<PendingAction>(null);
  const run = async (action: Exclude<PendingAction, null>) => {
    setPending(action);
    try {
      const result: SessionActionResponse = await (action === "focus" ? focusSession : resumeSession)(session.id);
      if (result.status === "focused") toast("Jumping to the session's Warp tab");
      else if (result.status === "resumed") toast(`Resuming in a new Warp tab in ${basename(result.cwd)}`);
      else toast(result.message, "bad");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't reach Warp", "bad");
    } finally {
      setPending(null);
    }
  };
  return { pending, run };
}

function SessionRow({ session }: { session: SessionView }) {
  const { pending, run } = useSessionAction(session);
  const canFocus = session.live && session.warpFocusUrl !== null;
  const lastActivity = session.lastActivity ? Date.parse(session.lastActivity) : null;
  return (
    <li className="flex flex-col gap-2.5 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <p className="m-0 line-clamp-2 min-w-0 flex-1 text-ui font-medium text-ink" title={session.title}>
          {session.title}
        </p>
        {session.plannedDoc ? <span className="chip chip-neutral flex-none">Planned</span> : null}
        {session.builtDoc ? <span className="chip chip-info flex-none">Built</span> : null}
        {session.live ? (
          <span className="chip chip-ok-soft flex-none gap-1.5">
            <LiveDot />
            Live
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-2 text-meta text-ink-64">
        {session.branch ? (
          <span
            className="chip chip-neutral min-w-0 max-w-[220px] gap-1 font-mono text-[11.5px]"
            title={session.branch}
          >
            <GitBranch className="size-3 flex-none" aria-hidden />
            <span className="truncate">{session.branch}</span>
          </span>
        ) : null}
        {session.cwd ? (
          <span className="flex max-w-[160px] flex-none items-center gap-1 font-mono text-[11.5px]" title={session.cwd}>
            <FolderGit2 className="size-3 flex-none text-ink-32" aria-hidden />
            <span className="truncate">{basename(session.cwd)}</span>
          </span>
        ) : null}
        {lastActivity ? (
          <time className="ml-auto flex-none text-ink-32 tabular-nums" dateTime={session.lastActivity ?? undefined}>
            {relativeTime(lastActivity)}
          </time>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {canFocus ? (
          <ActionButton
            tone="primary"
            busy={pending === "focus"}
            icon={<SquareTerminal className="size-3.5" aria-hidden />}
            onClick={() => void run("focus")}
          >
            Focus in Warp
          </ActionButton>
        ) : null}
        {session.canResume ? (
          <ActionButton
            tone="secondary"
            busy={pending === "resume"}
            icon={<Play className="size-3.5" aria-hidden />}
            onClick={() => void run("resume")}
          >
            Resume in Warp
          </ActionButton>
        ) : (
          <span className="text-meta text-ink-32">Directory no longer exists</span>
        )}
        <CopyResumeButton session={session} />
      </div>
    </li>
  );
}

function PanelBody({ sessions, scanning }: { sessions: SessionView[]; scanning: boolean }) {
  if (sessions.length === 0) {
    return (
      <p className="m-0 px-4 py-6 text-center text-ui text-ink-64">
        {scanning ? "Scanning Claude transcripts for this plan…" : "No Claude sessions have written to this plan yet."}
      </p>
    );
  }
  return (
    <ul className="scroll-quiet m-0 max-h-[min(60vh,520px)] list-none divide-y divide-line-soft overflow-y-auto p-0">
      {sessions.map((session) => (
        <SessionRow key={session.id} session={session} />
      ))}
    </ul>
  );
}

export function SessionsPanel({ docPath }: { docPath: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const containerRef = useDismiss<HTMLDivElement>(open, close);
  const { data } = useDocSessions(docPath);
  const sessions = data?.sessions ?? [];
  const scanning = data?.scanning ?? true;
  const liveCount = sessions.filter((session) => session.live).length;
  const label = liveCount > 0 ? `Sessions (${sessions.length}, ${liveCount} live)` : `Sessions (${sessions.length})`;
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className={`flex h-8 items-center gap-2 rounded-button border px-3 text-meta font-medium transition-colors duration-150 ${
          open ? "border-line bg-bg-sunken text-ink" : "border-line-soft text-ink-64 hover:border-line hover:text-ink"
        }`}
      >
        <Terminal className="size-3.5" strokeWidth={2} aria-hidden />
        Sessions
        {sessions.length > 0 ? (
          <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-line-soft px-1.5 text-[11px] font-semibold text-ink tabular-nums">
            {sessions.length}
          </span>
        ) : null}
        {liveCount > 0 ? <LiveDot /> : null}
        <ChevronDown className={`size-3.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Claude sessions for this plan"
          className="popover-enter popover-enter-right absolute top-full right-0 z-30 mt-2 w-[min(420px,calc(100vw-48px))] overflow-hidden rounded-card border border-line bg-surface-raised shadow-pop"
        >
          <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-64">Claude sessions</p>
            {scanning && sessions.length > 0 ? (
              <span className="ml-auto flex items-center gap-1.5 text-meta text-ink-32">
                <LoaderCircle className="size-3 animate-spin" aria-hidden />
                Scanning
              </span>
            ) : null}
          </div>
          <PanelBody sessions={sessions} scanning={scanning} />
        </div>
      ) : null}
    </div>
  );
}
