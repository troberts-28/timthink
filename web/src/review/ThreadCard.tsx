import type { Message, ReviewView, Thread } from "@timthink/server";
import { Check, CircleCheck, MessageSquare, PencilLine, RotateCcw, Trash2, TriangleAlert, X } from "lucide-react";
import { type CSSProperties, forwardRef, type KeyboardEvent, type MouseEvent, useState } from "react";
import { Button } from "../components/Button";
import { relativeTime } from "../lib/format";
import { InlineText } from "../markdown/InlineText";
import { Avatar } from "./Avatar";
import { useRequiredReview } from "./ReviewContext";
import { excerpt, isDraftMessage, isDraftThread, sectionTitle } from "./reviewModel";
import { SuggestionDiff } from "./SuggestionDiff";

function isSubmitShortcut(event: KeyboardEvent): boolean {
  return event.key === "Enter" && (event.metaKey || event.ctrlKey);
}

function displayName(message: Message, review: ReviewView): string {
  if (message.author === "claude") return message.name || "Claude";
  return message.name || review.userName;
}

function MessageRow({ message, review, onDelete }: { message: Message; review: ReviewView; onDelete?: () => void }) {
  const draft = isDraftMessage(review, message);
  return (
    <li className="flex gap-2.5">
      <Avatar author={message.author} name={displayName(message, review)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-meta">
          <span className="truncate font-semibold text-ink">{displayName(message, review)}</span>
          <time className="flex-none text-ink-32" dateTime={message.at}>
            {relativeTime(Date.parse(message.at))}
          </time>
          {draft ? <span className="chip chip-accent h-[18px] px-1.5 text-[11px]">Draft</span> : null}
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              aria-label="Delete draft reply"
              className="ml-auto grid size-5 place-items-center rounded-[6px] text-ink-32 hover:bg-bg-sunken hover:text-ink"
            >
              <X className="size-3" aria-hidden />
            </button>
          ) : null}
        </div>
        <p className="m-0 mt-0.5 whitespace-pre-wrap break-words text-[13.5px] leading-[1.5] text-ink">
          <InlineText text={message.body} />
        </p>
      </div>
    </li>
  );
}

function ReplyBox({ thread }: { thread: Thread }) {
  const { actions } = useRequiredReview();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const send = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    const ok = await actions.reply(thread.id, text);
    setSaving(false);
    if (ok) {
      setText("");
      setOpen(false);
    }
  };
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-chip border border-line-soft bg-bg px-2.5 py-1.5 text-left text-meta text-ink-32 transition-colors duration-150 hover:border-line hover:text-ink-64"
      >
        Reply…
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <textarea
        // biome-ignore lint/a11y/noAutofocus: the reply box opens on an explicit click.
        autoFocus
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (isSubmitShortcut(event)) void send();
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder="Reply (added to your pending review)"
        className="field min-h-[60px] text-[13.5px]"
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button tone="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button tone="primary" size="sm" disabled={!text.trim() || saving} onClick={() => void send()}>
          Reply
        </Button>
      </div>
    </div>
  );
}

function DraftEditor({ thread, onDone }: { thread: Thread; onDone: () => void }) {
  const { actions } = useRequiredReview();
  const [body, setBody] = useState(thread.messages[0]?.body ?? "");
  const [suggestion, setSuggestion] = useState(thread.suggestion ?? "");
  const save = async () => {
    const ok = await actions.editThread(thread.id, body, thread.kind === "suggestion" ? suggestion : null);
    if (ok) onDone();
  };
  return (
    <div className="flex flex-col gap-2">
      {thread.kind === "suggestion" ? (
        <textarea
          rows={3}
          value={suggestion}
          onChange={(event) => setSuggestion(event.target.value)}
          className="field font-mono text-[12.5px]"
          aria-label="Suggested replacement"
        />
      ) : null}
      <textarea
        rows={2}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (isSubmitShortcut(event)) void save();
          if (event.key === "Escape") onDone();
        }}
        className="field text-[13.5px]"
        aria-label="Comment"
        placeholder={thread.kind === "suggestion" ? "Why? (optional)" : "Comment"}
      />
      <div className="flex justify-end gap-1.5">
        <Button tone="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button tone="primary" size="sm" onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}

function ThreadActions({ thread, draft, onEdit }: { thread: Thread; draft: boolean; onEdit: () => void }) {
  const { actions } = useRequiredReview();
  if (draft) {
    return (
      <div className="flex items-center gap-1">
        <Button tone="ghost" size="sm" icon={<PencilLine className="size-3.5" aria-hidden />} onClick={onEdit}>
          Edit
        </Button>
        <Button
          tone="ghost"
          size="sm"
          icon={<Trash2 className="size-3.5" aria-hidden />}
          onClick={() => void actions.deleteThread(thread.id)}
        >
          Delete
        </Button>
      </div>
    );
  }
  if (thread.status === "resolved") {
    return (
      <Button
        tone="ghost"
        size="sm"
        icon={<RotateCcw className="size-3.5" aria-hidden />}
        onClick={() => void actions.setResolved(thread.id, false)}
      >
        Reopen
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {thread.kind === "suggestion" && thread.status === "open" ? (
        <Button
          tone="secondary"
          size="sm"
          icon={<Check className="size-3.5 text-ok" aria-hidden />}
          onClick={() => void actions.accept(thread.id)}
        >
          Accept
        </Button>
      ) : null}
      <Button
        tone="ghost"
        size="sm"
        icon={<CircleCheck className="size-3.5" aria-hidden />}
        onClick={() => void actions.setResolved(thread.id, true)}
      >
        Resolve
      </Button>
    </div>
  );
}

function CollapsedThread({ thread, onExpand }: { thread: Thread; onExpand: () => void }) {
  const who = thread.resolvedBy === "claude" ? "Claude" : "you";
  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex w-full items-center gap-2 rounded-card border border-line-soft bg-surface/60 px-3 py-2 text-left text-meta text-ink-64 transition-colors duration-150 hover:border-line hover:text-ink"
    >
      <CircleCheck className="size-3.5 flex-none text-ok" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        <span className="italic">“{excerpt(thread.anchor.quote, 48)}”</span>
      </span>
      <span className="flex-none text-ink-32">Resolved by {who}</span>
    </button>
  );
}

function ThreadQuote({ thread, outdated }: { thread: Thread; outdated: boolean }) {
  if (thread.kind === "suggestion" && !outdated) return null;
  const section = sectionTitle(thread.anchor.quote);
  if (section) {
    return (
      <p className="thread-quote line-clamp-1 not-italic" title={thread.anchor.quote}>
        <span className="font-medium">Whole section:</span> {section}
      </p>
    );
  }
  return (
    <p className={`thread-quote ${outdated ? "line-clamp-4" : "line-clamp-2"}`} title={thread.anchor.quote}>
      {thread.anchor.quote}
    </p>
  );
}

interface ThreadCardProps {
  thread: Thread;
  active: boolean;
  onActivate: (thread: Thread) => void;
  style?: CSSProperties;
  className?: string;
}

export const ThreadCard = forwardRef<HTMLDivElement, ThreadCardProps>(function ThreadCard(
  { thread, active, onActivate, style, className = "" },
  ref,
) {
  const { review, actions } = useRequiredReview();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  if (!review) return null;
  const draft = isDraftThread(review, thread);
  const outdated = thread.status === "outdated";
  const collapsed = thread.status === "resolved" && !expanded && !active;

  const activate = (event: MouseEvent) => {
    if (event.target instanceof HTMLElement && event.target.closest("button, textarea, a, input")) return;
    onActivate(thread);
  };

  if (collapsed) {
    return (
      <div ref={ref} style={style} className={className} data-thread-id={thread.id}>
        <CollapsedThread
          thread={thread}
          onExpand={() => {
            setExpanded(true);
            onActivate(thread);
          }}
        />
      </div>
    );
  }

  const [first, ...rest] = thread.messages;
  const comment = draft && first?.author === "human" ? first : null;
  const conversation = comment ? rest : thread.messages;

  return (
    <div ref={ref} style={style} className={className} data-thread-id={thread.id}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: activation is a pointer convenience; every action inside is a real button. */}
      <article
        onClick={activate}
        aria-label={`${thread.kind === "suggestion" ? "Suggestion" : "Comment"} on “${excerpt(thread.anchor.quote, 40)}”`}
        className={`thread-card ${active ? "is-active" : ""} ${thread.status === "resolved" ? "is-resolved" : ""}`}
      >
        <header className="flex items-center gap-1.5 text-meta">
          {thread.kind === "suggestion" ? (
            <span className="chip chip-ok-soft h-5 px-1.5 text-[11px]">
              <PencilLine className="size-3" aria-hidden />
              Suggestion
            </span>
          ) : (
            <span className="flex items-center gap-1 font-medium text-ink-64">
              <MessageSquare className="size-3.5" aria-hidden />
              Comment
            </span>
          )}
          {draft ? <span className="chip chip-accent h-5 px-1.5 text-[11px]">Draft</span> : null}
          {outdated ? (
            <span className="chip chip-neutral h-5 px-1.5 text-[11px]">
              <TriangleAlert className="size-3" aria-hidden />
              Outdated
            </span>
          ) : null}
          {thread.status === "resolved" ? (
            <span className="chip chip-ok-soft h-5 px-1.5 text-[11px]">Resolved</span>
          ) : null}
        </header>
        <ThreadQuote thread={thread} outdated={outdated} />
        {editing ? (
          <DraftEditor thread={thread} onDone={() => setEditing(false)} />
        ) : (
          <>
            {thread.kind === "suggestion" && thread.suggestion !== null ? (
              <SuggestionDiff before={thread.anchor.quote} after={thread.suggestion} className="thread-diff" />
            ) : null}
            {comment ? (
              <p className="m-0 whitespace-pre-wrap break-words text-[13.5px] leading-[1.5] text-ink">
                <InlineText text={comment.body} />
              </p>
            ) : null}
          </>
        )}
        {conversation.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-3 border-t border-line-soft p-0 pt-3">
            {conversation.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                review={review}
                onDelete={
                  isDraftMessage(review, message) && !draft ? () => void actions.deleteMessage(message.id) : undefined
                }
              />
            ))}
          </ul>
        ) : null}
        {!draft && !editing ? <ReplyBox thread={thread} /> : null}
        {!editing ? (
          <footer className="-mx-1 -mb-1 flex items-center justify-between gap-2">
            <span className="pl-1 text-meta text-ink-32">
              {draft ? "Sent when you submit" : relativeTime(Date.parse(thread.createdAt))}
            </span>
            <ThreadActions thread={thread} draft={draft} onEdit={() => setEditing(true)} />
          </footer>
        ) : null}
      </article>
    </div>
  );
});
