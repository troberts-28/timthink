import type { InboxItem, SessionActionResponse } from "@timthink/server";
import { Check, Copy, LoaderCircle, Play, SquareTerminal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { markSeen } from "../api/changes";
import { focusSession, resumeSession } from "../api/client";
import { Button } from "../components/Button";
import { StatusDot } from "../components/StatusChip";
import { relativeTime } from "../lib/format";
import { docHref } from "../lib/routes";
import { useToast } from "../lib/toast";
import { reviewCommand } from "../review/handOff";
import { reasonChip } from "./inboxModel";

const COPIED_FEEDBACK_MS = 1500;

function location(item: InboxItem, showRepo: boolean): string | null {
  const { repo, project } = item.doc;
  const projectName = project && project !== repo ? project : null;
  if (!showRepo) return projectName;
  return projectName ? `${repo} / ${projectName}` : repo;
}

function CopyCommandButton({ docPath }: { docPath: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const command = reviewCommand(docPath);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
      toast(
        <>
          Copied <code className="font-mono text-[12.5px]">{command}</code>
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
      title={`Copy “${command}”`}
      aria-label="Copy the review command"
      className="grid size-8 flex-none place-items-center rounded-button text-ink-64 transition-colors duration-150 hover:bg-bg-sunken hover:text-ink"
    >
      {copied ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

function SessionButton({ item }: { item: InboxItem }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const session = item.session;
  if (!session || (!session.canFocus && !session.canResume)) return null;
  const focus = session.canFocus;
  const run = async () => {
    setBusy(true);
    try {
      const result: SessionActionResponse = await (focus ? focusSession : resumeSession)(session.id);
      if (result.status === "focused") toast("Jumping to the session's Warp tab");
      else if (result.status === "resumed") toast("Resuming the session in a new Warp tab");
      else toast(result.message, "bad");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't reach Warp", "bad");
    } finally {
      setBusy(false);
    }
  };
  const icon = busy ? (
    <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
  ) : focus ? (
    <SquareTerminal className="size-3.5" aria-hidden />
  ) : (
    <Play className="size-3.5" aria-hidden />
  );
  return (
    <Button
      tone={focus ? "primary" : "secondary"}
      disabled={busy}
      icon={icon}
      onClick={() => void run()}
      title={session.title}
    >
      {focus ? "Focus in Warp" : "Resume in Warp"}
    </Button>
  );
}

function MarkSeenButton({ item }: { item: InboxItem }) {
  const toast = useToast();
  return (
    <Button
      tone="ghost"
      icon={<Check className="size-3.5" aria-hidden />}
      onClick={() => {
        markSeen(item.doc.path, item.doc.hash).catch(() => toast("Couldn't mark the plan as seen", "bad"));
      }}
    >
      Mark seen
    </Button>
  );
}

function actionsFor(item: InboxItem): ReactNode {
  if (item.section === "waiting") {
    return (
      <>
        <SessionButton item={item} />
        <CopyCommandButton docPath={item.doc.path} />
      </>
    );
  }
  if (item.section === "changed") return <MarkSeenButton item={item} />;
  return null;
}

function Detail({ item }: { item: InboxItem }) {
  if (!item.detail) return null;
  if (item.section === "questions") {
    return <p className="m-0 mt-1.5 line-clamp-2 text-ui text-ink">{item.detail}</p>;
  }
  return (
    <p className="m-0 mt-1.5 line-clamp-2 text-ui text-ink-64">
      <span className="font-medium text-ink">Claude:</span> {item.detail}
    </p>
  );
}

export function InboxRow({ item, showRepo }: { item: InboxItem; showRepo: boolean }) {
  const chip = reasonChip(item);
  const place = location(item, showRepo);
  const actions = actionsFor(item);
  const href = item.questionId
    ? `${docHref(item.doc.path)}#question-${encodeURIComponent(item.questionId)}`
    : docHref(item.doc.path);
  return (
    <li className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-6 border-b border-line-soft px-5 py-3.5 transition-colors duration-150 last:border-b-0 hover:bg-bg/60">
      <div className="flex min-w-0 items-start gap-3">
        <StatusDot status={item.doc.status} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <Link
            to={href}
            className="block truncate text-ui font-medium text-ink after:absolute after:inset-0 after:content-['']"
          >
            {item.doc.title}
          </Link>
          <p className="m-0 mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-64">
            <span className={`chip ${chip.className}`}>{chip.label}</span>
            {place ? <span className="truncate">{place}</span> : null}
          </p>
          <Detail item={item} />
        </div>
      </div>
      <div className="relative z-10 flex items-center gap-2">
        {actions}
        <time
          dateTime={item.at}
          className="min-w-[64px] text-right text-meta whitespace-nowrap text-ink-64 tabular-nums"
        >
          {relativeTime(Date.parse(item.at))}
        </time>
      </div>
    </li>
  );
}
