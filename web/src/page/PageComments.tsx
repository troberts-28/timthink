import { useQueryClient } from "@tanstack/react-query";
import type { Thread } from "@timthink/server";
import { blockIdOf, blockIdQuote } from "@timthink/server/shared";
import { MessageSquarePlus, Send } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { queryKeys } from "../api/queries";
import { Button } from "../components/Button";
import { pluralise } from "../lib/format";
import { useToast } from "../lib/toast";
import { copyText, reviewCommand } from "../review/handOff";
import { useRequiredReview } from "../review/ReviewContext";
import { byDocumentOrder, pendingCounts } from "../review/reviewModel";
import { ThreadCard } from "../review/ThreadCard";
import { useClaudeActivityToasts } from "../review/useClaudeActivityToasts";

const COMMENTED_ATTRIBUTE = "data-commented";

export function CommentableBlocks({ children }: { children: ReactNode }) {
  const { review, setActiveThreadId } = useRequiredReview();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<BlockSpot | null>(null);
  const [composing, setComposing] = useState<BlockSpot | null>(null);
  const threads = review?.threads ?? [];
  const commentedIds = [...new Set(threads.filter(isOpen).flatMap((thread) => blockIdOf(thread.anchor.quote) ?? []))];
  const commentedKey = commentedIds.join("\n");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const ids = new Set(commentedKey.split("\n"));
    for (const block of container.querySelectorAll<HTMLElement>("[data-block-id]")) {
      block.toggleAttribute(COMMENTED_ATTRIBUTE, ids.has(block.dataset.blockId ?? ""));
    }
  });

  const revealButton = (event: { target: EventTarget }) => {
    const container = containerRef.current;
    if (composing || !container || !(event.target instanceof Element) || event.target.closest(".block-comment-ui")) {
      return;
    }
    const block = event.target.closest<HTMLElement>("[data-block-id]");
    setHovered(block && container.contains(block) ? spotOf(block, container) : null);
  };

  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || event.target.closest("a, button, input, textarea")) {
      return;
    }
    const blockId = event.target.closest<HTMLElement>(`[${COMMENTED_ATTRIBUTE}]`)?.dataset.blockId;
    const first = threads.filter(isOpen).find((thread) => blockIdOf(thread.anchor.quote) === blockId);
    if (first) {
      setActiveThreadId(first.id);
      document.querySelector(`[data-thread-id="${first.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };

  const spot = composing ?? hovered;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: hover reveals a real comment button, and clicking a commented block is a shortcut to its threads, which are listed below the page.
    <div
      ref={containerRef}
      className="page-blocks relative"
      onMouseOver={revealButton}
      onFocus={revealButton}
      onMouseLeave={() => setHovered(null)}
      onClick={onClick}
    >
      {children}
      {spot ? (
        <button
          type="button"
          className="block-comment-ui absolute grid size-7 place-items-center rounded-button border border-line bg-surface-raised text-ink-64 shadow-pop hover:text-ink"
          style={{ top: spot.top, left: spot.right + 8 }}
          onClick={() => setComposing(spot)}
          aria-label={`Comment on ${spot.blockId}`}
          title={`Comment on ${spot.blockId}`}
        >
          <MessageSquarePlus className="size-3.5" aria-hidden />
        </button>
      ) : null}
      {composing ? <BlockComposer spot={composing} onClose={() => setComposing(null)} key={composing.blockId} /> : null}
    </div>
  );
}

export function PageThreads() {
  const { review, docPath, anchorsCurrent, activeThreadId, setActiveThreadId } = useRequiredReview();
  const queryClient = useQueryClient();
  useClaudeActivityToasts(review);
  useEffect(() => {
    if (review && !anchorsCurrent) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.review(docPath) });
    }
  }, [review, anchorsCurrent, queryClient, docPath]);
  const threads = [...(review?.threads ?? [])].sort(byDocumentOrder);
  if (threads.length === 0) {
    return null;
  }
  const activate = (thread: Thread) => {
    setActiveThreadId(thread.id);
    const blockId = blockIdOf(thread.anchor.quote);
    if (thread.status !== "outdated" && blockId) {
      document
        .querySelector(`.page-blocks [data-block-id="${CSS.escape(blockId)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };
  return (
    <section className="mb-10" aria-label="Comments on the project page">
      <div className="grid gap-3 sm:grid-cols-2">
        {threads.map((thread) => (
          <div key={thread.id}>
            <p className="m-0 mb-1 text-meta text-ink-64">
              {thread.status === "outdated" ? "No longer on the page · " : ""}
              Block <code className="font-mono">{blockIdOf(thread.anchor.quote) ?? thread.anchor.quote}</code>
            </p>
            <ThreadCard thread={thread} active={thread.id === activeThreadId} onActivate={activate} />
          </div>
        ))}
      </div>
      <SendBar />
    </section>
  );
}

function SendBar() {
  const { review, docPath, actions } = useRequiredReview();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const counts = pendingCounts(review);
  if (counts.total === 0) {
    return null;
  }
  const send = async () => {
    setSending(true);
    const result = await actions.submit("comment", "");
    setSending(false);
    if (!result) {
      return;
    }
    const command = reviewCommand(docPath);
    toast(
      (await copyText(command)) ? (
        <>
          Sent. Copied <code className="font-mono text-[12.5px]">{command}</code> for Claude.
        </>
      ) : (
        "Sent to Claude."
      ),
    );
  };
  return (
    <div className="sticky bottom-5 z-20 mt-4 flex items-center gap-3 rounded-card border border-line bg-surface-raised py-2.5 pr-2.5 pl-4 shadow-pop">
      <span className="size-2 flex-none rounded-full bg-accent" aria-hidden />
      <p className="m-0 min-w-0 flex-1 truncate text-ui font-medium text-ink">
        {[
          counts.comments > 0 ? pluralise(counts.comments, "draft comment") : null,
          counts.replies > 0 ? pluralise(counts.replies, "draft reply", "draft replies") : null,
        ]
          .filter(Boolean)
          .join(" · ")}{" "}
        on the page
      </p>
      <Button
        tone="primary"
        disabled={sending}
        icon={<Send className="size-3.5" aria-hidden />}
        onClick={() => void send()}
      >
        Send to Claude
      </Button>
    </div>
  );
}

function BlockComposer({ spot, onClose }: { spot: BlockSpot; onClose: () => void }) {
  const { raw, actions } = useRequiredReview();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving || !body.trim()) {
      return;
    }
    const range = blockSourceRange(raw, spot.blockId);
    if (!range) {
      toast(`“${spot.blockId}” isn't written in project.page.tsx, so it can't take comments`, "bad");
      onClose();
      return;
    }
    setSaving(true);
    const saved = await actions.createThread({ kind: "comment", ...range, body, suggestion: null });
    setSaving(false);
    if (saved) {
      onClose();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-label={`Comment on ${spot.blockId}`}
      className="block-comment-ui popover-enter popover-enter-right absolute z-30 w-[360px] rounded-card border border-line bg-surface-raised p-3 shadow-pop"
      style={{ top: spot.top + 36, left: Math.max(0, spot.right + 36 - 360) }}
    >
      <p className="m-0 mb-2 text-meta text-ink-64">
        Comment on <code className="font-mono">{spot.blockId}</code>
      </p>
      <textarea
        // biome-ignore lint/a11y/noAutofocus: the composer opens on an explicit click and is where the next keystroke belongs.
        autoFocus
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder="What should change here?"
        className="block w-full resize-y rounded-button border border-line bg-surface px-3 py-2 text-ui text-ink outline-none focus:border-accent"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button tone="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button tone="primary" disabled={saving || !body.trim()} onClick={() => void save()}>
          Comment
        </Button>
      </div>
    </div>
  );
}

function blockSourceRange(raw: string, blockId: string) {
  const quote = blockIdQuote(blockId);
  const start = raw.indexOf(quote);
  if (start === -1 || raw.indexOf(quote, start + 1) !== -1) {
    return null;
  }
  return { start, end: start + quote.length };
}

function spotOf(block: HTMLElement, container: HTMLElement): BlockSpot {
  const blockRect = block.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return {
    blockId: block.dataset.blockId ?? "",
    top: blockRect.top - containerRect.top,
    right: blockRect.right - containerRect.left,
  };
}

function isOpen(thread: Thread) {
  return thread.status === "open";
}

interface BlockSpot {
  blockId: string;
  top: number;
  right: number;
}
