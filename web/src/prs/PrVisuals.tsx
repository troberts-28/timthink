import type { PrAttention, PrInfo, PrState } from "@timthink/server";
import { CircleCheck, CircleDashed, CircleX, MessageSquareWarning } from "lucide-react";

export const PR_STATE_LABELS: Record<PrState, string> = {
  draft: "Draft",
  open: "Open",
  queued: "In merge queue",
  merged: "Merged",
  closed: "Closed without merging",
};

const PR_STATE_DOTS: Record<PrState, string> = {
  draft: "border border-ink-32 bg-transparent",
  open: "bg-info",
  queued: "bg-accent",
  merged: "bg-ok",
  closed: "bg-ink-32",
};

export function PrStateDot({ state, className = "" }: { state: PrState | null; className?: string }) {
  const tone = state ? PR_STATE_DOTS[state] : "border border-dashed border-ink-32";
  return <span className={`inline-block size-2 flex-none rounded-full ${tone} ${className}`} aria-hidden />;
}

export function PrSignals({ info }: { info: PrInfo }) {
  if (info.state === "merged" || info.state === "closed") return null;
  return (
    <>
      {info.ci === "failing" ? <CircleX className="size-3 text-bad" aria-label="CI failing" /> : null}
      {info.ci === "pending" ? <CircleDashed className="size-3 text-ink-32" aria-label="CI running" /> : null}
      {info.review === "changes_requested" ? (
        <MessageSquareWarning className="size-3 text-bad" aria-label="Changes requested" />
      ) : null}
      {info.review === "approved" && info.ci !== "failing" ? (
        <CircleCheck className="size-3 text-ok" aria-label="Approved" />
      ) : null}
    </>
  );
}

function ciText(info: PrInfo): string | null {
  if (info.ci === "failing") {
    const checks = info.failingChecks.slice(0, 3).join(", ");
    return `CI failing${checks ? `: ${checks}${info.failingChecks.length > 3 ? "…" : ""}` : ""}`;
  }
  if (info.ci === "pending") return "CI running";
  if (info.ci === "passing") return "CI passing";
  return null;
}

function reviewText(info: PrInfo): string | null {
  const threads = info.unresolvedThreads > 0 ? `, ${info.unresolvedThreads} unresolved` : "";
  if (info.review === "changes_requested") return `Changes requested${threads}`;
  if (info.review === "approved") return `Approved${threads}`;
  if (info.review === "review_required") return `Review required${threads}`;
  return threads ? `${info.unresolvedThreads} unresolved threads` : null;
}

export function prSummaryLines(info: PrInfo): string[] {
  const live = info.state !== "merged" && info.state !== "closed";
  return [PR_STATE_LABELS[info.state], live ? ciText(info) : null, live ? reviewText(info) : null].filter(
    (line): line is string => line !== null,
  );
}

export function PrCard({ info, bare = false }: { info: PrInfo; bare?: boolean }) {
  return (
    <span className={bare ? "contents" : "pr-card"} role="tooltip">
      <span className="flex items-center gap-2 text-meta text-ink-64">
        <PrStateDot state={info.state} />
        <span className="font-mono">
          {info.owner}/{info.repo}#{info.number}
        </span>
      </span>
      <span className="block text-ui font-medium text-ink">{info.title}</span>
      {prSummaryLines(info).map((line) => (
        <span key={line} className="block text-meta text-ink-64">
          {line}
        </span>
      ))}
    </span>
  );
}

const ATTENTION_LABELS: Record<PrAttention, string> = {
  "ci-failing": "CI is failing on one of this plan's PRs",
  "changes-requested": "Changes were requested on one of this plan's PRs",
};

export function PrAttentionIcon({ attention }: { attention: PrAttention | null }) {
  if (!attention) return null;
  const Icon = attention === "ci-failing" ? CircleX : MessageSquareWarning;
  return (
    <span className="flex-none text-bad" title={ATTENTION_LABELS[attention]}>
      <Icon className="size-3.5" strokeWidth={2} aria-label={ATTENTION_LABELS[attention]} />
    </span>
  );
}
