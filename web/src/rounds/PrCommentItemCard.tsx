import type { PrCommentItem, RoundOption, RoundOutcome } from "@timthink/server";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useRoundFile } from "../api/queries";
import { Button } from "../components/Button";
import { type ItemDraft, withOption, withOther } from "./itemDraft";

export interface DraftChange {
  draft: ItemDraft;
  typing: boolean;
}

interface PrCommentItemCardProps {
  roundId: string;
  item: PrCommentItem;
  index: number;
  draft: ItemDraft;
  outcome: RoundOutcome | null;
  editable: boolean;
  active: boolean;
  onActivate: () => void;
  onChange: (change: DraftChange) => void;
}

export function roundItemElementId(itemId: string) {
  return `round-item-${itemId}`;
}

export function roundReplyElementId(itemId: string) {
  return `round-reply-${itemId}`;
}

export function roundOtherElementId(itemId: string) {
  return `round-other-${itemId}`;
}

export function PrCommentItemCard({
  roundId,
  item,
  index,
  draft,
  outcome,
  editable,
  active,
  onActivate,
  onChange,
}: PrCommentItemCardProps) {
  return (
    <article
      id={roundItemElementId(item.id)}
      onFocusCapture={onActivate}
      onMouseDown={onActivate}
      className={`scroll-mt-24 rounded-card border bg-surface transition-colors duration-150 ${
        active ? "border-accent" : "border-line"
      }`}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5 text-meta text-ink-64">
        <span className="font-mono text-ink-32 tabular-nums">#{index + 1}</span>
        {item.path ? (
          <span className="font-mono text-ink">
            {item.path}
            {item.line ? `:${item.line}` : ""}
          </span>
        ) : (
          <span className="text-ink">PR comment</span>
        )}
        <span>· {authorLine(item)}</span>
        {item.flags.outdated ? <span className="chip chip-muted">Outdated</span> : null}
        {item.flags.summary ? <span className="chip chip-muted">Summary</span> : null}
        {outcome ? <OutcomeChip outcome={outcome} /> : null}
      </header>
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-6 px-4 py-4">
        <ThreadContext roundId={roundId} item={item} />
        <DecisionPanel item={item} draft={draft} editable={editable} onChange={onChange} />
      </div>
    </article>
  );
}

function authorLine(item: PrCommentItem) {
  const others = item.participants.filter((name) => name !== item.author);
  return others.length > 0 ? `${item.author} (+${others.length}: ${others.join(", ")})` : item.author;
}

function ThreadContext({ roundId, item }: { roundId: string; item: PrCommentItem }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {item.messages.map((message) => (
          <li key={`${message.author}:${message.at}:${message.body}`} className="text-ui">
            <span className="font-semibold text-ink">{message.author}</span>
            <p className="m-0 mt-0.5 whitespace-pre-wrap break-words text-ink-64">{message.body}</p>
          </li>
        ))}
      </ol>
      {item.diffHunk ? <DiffHunk hunk={item.diffHunk} /> : null}
      {item.path && item.line ? <CodeAtHead roundId={roundId} itemId={item.id} /> : null}
    </div>
  );
}

function DiffHunk({ hunk }: { hunk: string }) {
  return (
    <pre className="m-0 overflow-x-auto rounded-[6px] border border-line-soft bg-bg-sunken/60 px-3 py-2 font-mono text-[12px] leading-[1.5]">
      {linesWithOffsets(hunk).map(({ line, offset }) => (
        <span key={offset} className={`block ${diffLineClass(line)}`}>
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

function linesWithOffsets(text: string) {
  let offset = 0;
  return text.split("\n").map((line) => {
    const entry = { line, offset };
    offset += line.length + 1;
    return entry;
  });
}

function diffLineClass(line: string) {
  if (line.startsWith("+")) {
    return "text-ok-ink";
  }
  if (line.startsWith("-")) {
    return "text-bad-ink";
  }
  return line.startsWith("@@") ? "text-ink-32" : "text-ink-64";
}

function CodeAtHead({ roundId, itemId }: { roundId: string; itemId: string }) {
  const [open, setOpen] = useState(false);
  const { data: context, isLoading } = useRoundFile(roundId, itemId, open);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-1 text-meta font-medium text-ink-64 hover:text-ink"
      >
        <ChevronRight
          className={`size-3.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          strokeWidth={1.75}
          aria-hidden
        />
        Code at the PR head
      </button>
      {open && isLoading ? <p className="m-0 mt-2 text-meta text-ink-32">Reading the checkout…</p> : null}
      {open && context?.status === "unavailable" ? (
        <p className="m-0 mt-2 text-meta text-ink-32">{context.message}</p>
      ) : null}
      {open && context?.status === "ok" ? (
        <pre className="m-0 mt-2 overflow-x-auto rounded-[6px] border border-line-soft bg-bg-sunken/60 py-2 font-mono text-[12px] leading-[1.5]">
          {context.lines.map((line, position) => {
            const lineNumber = context.startLine + position;
            return (
              <span
                key={lineNumber}
                className={`flex gap-3 px-3 ${lineNumber === context.line ? "bg-accent-soft text-ink" : "text-ink-64"}`}
              >
                <span className="w-8 flex-none select-none text-right text-ink-32 tabular-nums">{lineNumber}</span>
                <span className="whitespace-pre">{line || " "}</span>
              </span>
            );
          })}
        </pre>
      ) : null}
    </div>
  );
}

interface DecisionPanelProps {
  item: PrCommentItem;
  draft: ItemDraft;
  editable: boolean;
  onChange: (change: DraftChange) => void;
}

function DecisionPanel({ item, draft, editable, onChange }: DecisionPanelProps) {
  const { selection } = draft;
  return (
    <div className="flex min-w-0 flex-col gap-3 text-ui">
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="text-meta font-medium text-ink-32">Said</dt>
        <dd className="m-0 text-ink">{item.said}</dd>
        <dt className="text-meta font-medium text-ink-32">My read</dt>
        <dd className="m-0 text-ink">
          <span className="chip chip-neutral mr-1.5">{item.read.assessment}</span>
          {item.read.reason}
        </dd>
        <dt className="text-meta font-medium text-ink-32">Fix</dt>
        <dd className="m-0 text-ink">{item.fix}</dd>
      </dl>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" disabled={!editable}>
        <legend className="sr-only">Decision</legend>
        {item.options.map((option, position) => (
          <OptionRow
            key={option.id}
            itemId={item.id}
            option={option}
            shortcut={position + 1}
            checked={selection?.kind === "option" && selection.optionId === option.id}
            onSelect={() => onChange({ draft: withOption(item, draft, option.id), typing: false })}
          />
        ))}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-[6px] px-2 py-1.5 hover:bg-bg/60">
          <input
            type="radio"
            name={`decision-${item.id}`}
            checked={selection?.kind === "other"}
            onChange={() => onChange({ draft: withOther(item, draft), typing: false })}
            className="mt-1"
          />
          <span className="min-w-0 flex-1">
            <span className="font-medium text-ink">Other</span>
            <span className="ml-2 font-mono text-[11px] text-ink-32">{item.options.length + 1}</span>
            <span className="block text-meta text-ink-64">Your own fix, which Claude makes instead</span>
          </span>
        </label>
        {selection?.kind === "other" ? (
          <textarea
            id={roundOtherElementId(item.id)}
            rows={2}
            value={draft.otherText}
            onChange={(event) => onChange({ draft: { ...draft, otherText: event.target.value }, typing: true })}
            placeholder="What should Claude do instead?"
            className="field ml-7 text-[13.5px]"
          />
        ) : null}
      </fieldset>
      <ReplyEditor item={item} draft={draft} editable={editable} onChange={onChange} />
    </div>
  );
}

interface OptionRowProps {
  itemId: string;
  option: RoundOption;
  shortcut: number;
  checked: boolean;
  onSelect: () => void;
}

function OptionRow({ itemId, option, shortcut, checked, onSelect }: OptionRowProps) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-[6px] px-2 py-1.5 ${checked ? "bg-accent-soft" : "hover:bg-bg/60"}`}
    >
      <input type="radio" name={`decision-${itemId}`} checked={checked} onChange={onSelect} className="mt-1" />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-ink">{option.label}</span>
        <span className="ml-2 font-mono text-[11px] text-ink-32">{shortcut}</span>
        {option.hint ? <span className="block text-meta text-ink-64">{option.hint}</span> : null}
      </span>
    </label>
  );
}

function ReplyEditor({ item, draft, editable, onChange }: DecisionPanelProps) {
  const { reply } = item;
  const isOther = draft.selection?.kind === "other";
  const hint =
    reply.kind === "yours"
      ? "Posted under your name. Leave it empty to post nothing."
      : isOther
        ? "Leave it empty and Claude words the reply from your fix."
        : "Posted on the thread as written. Leave it empty to post nothing.";
  if (!editable) {
    return draft.reply ? (
      <div>
        <p className="m-0 text-meta font-medium text-ink-32">{reply.kind === "yours" ? "Your reply" : "Reply"}</p>
        <p className="m-0 mt-0.5 whitespace-pre-wrap text-ink">{draft.reply}</p>
      </div>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={roundReplyElementId(item.id)} className="text-meta font-medium text-ink-32">
        {reply.kind === "yours" ? "Your reply" : "Reply on the thread"}
      </label>
      <textarea
        id={roundReplyElementId(item.id)}
        rows={3}
        value={draft.reply}
        onChange={(event) => onChange({ draft: { ...draft, reply: event.target.value }, typing: true })}
        disabled={draft.selection === null}
        placeholder={draft.selection === null ? "Pick an option first" : undefined}
        className="field text-[13.5px]"
      />
      <p className="m-0 text-meta text-ink-32">{hint}</p>
      {reply.kind === "yours" && reply.suggestion ? (
        <div className="flex items-start gap-3 rounded-[6px] border border-line-soft bg-bg-sunken/60 px-3 py-2">
          <p className="m-0 min-w-0 flex-1 text-meta text-ink-64">
            <span className="font-medium text-ink">Claude suggests:</span> {reply.suggestion}
          </p>
          <Button
            size="sm"
            tone="ghost"
            disabled={draft.selection === null}
            onClick={() => onChange({ draft: { ...draft, reply: reply.suggestion ?? "" }, typing: false })}
          >
            Use suggestion
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const OUTCOME_CHIPS: Record<RoundOutcome["kind"], { label: string; className: string }> = {
  fixed: { label: "Fixed", className: "chip-ok-soft" },
  replied: { label: "Replied", className: "chip-info" },
  "no-change": { label: "No change", className: "chip-neutral" },
  deferred: { label: "Deferred", className: "chip-accent" },
  skipped: { label: "Skipped", className: "chip-muted" },
  moved: { label: "Moved", className: "chip-ok-soft" },
};

export function OutcomeChip({ outcome }: { outcome: RoundOutcome }) {
  const chip = OUTCOME_CHIPS[outcome.kind];
  const detail = [outcome.commit?.slice(0, 7), outcome.note].filter(Boolean).join(" · ");
  return (
    <span className="ml-auto flex items-center gap-2">
      <span className={`chip ${chip.className}`}>{chip.label}</span>
      {detail ? <span className="truncate text-ink-64">{detail}</span> : null}
    </span>
  );
}
