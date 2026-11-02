import type { Thread } from "@timthink/server";
import { MessagesSquare, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useRequiredReview } from "./ReviewContext";
import { ThreadCard } from "./ThreadCard";
import { OutdatedGroup, ThreadPanelHeader } from "./ThreadPanelHeader";
import { groupThreads } from "./threadGroups";

interface ThreadDrawerProps {
  open: boolean;
  onClose: () => void;
  ranges: ReadonlyMap<string, Range>;
  onActivate: (thread: Thread) => void;
}

export function ThreadDrawer({ open, onClose, ranges, onActivate }: ThreadDrawerProps) {
  const { review, activeThreadId, showResolved } = useRequiredReview();
  const groups = useMemo(() => groupThreads(review, ranges, showResolved), [review, ranges, showResolved]);
  const openCount = (review?.threads ?? []).filter((thread) => thread.status === "open").length;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <button type="button" aria-label="Close threads" className="drawer-backdrop" onClick={onClose} />
      <aside
        aria-label="Review threads"
        className="drawer-panel absolute top-0 right-0 bottom-0 flex w-[min(400px,100vw)] flex-col border-l border-line bg-bg shadow-modal"
      >
        <div className="flex h-12 flex-none items-center gap-2 border-b border-line-soft px-4">
          <MessagesSquare className="size-4 text-ink-64" aria-hidden />
          <p className="m-0 text-ui font-semibold">Threads</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close threads"
            className="ml-auto grid size-8 place-items-center rounded-button text-ink-64 hover:bg-bg-sunken hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="scroll-quiet flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <ThreadPanelHeader openCount={openCount} resolvedCount={groups.resolvedCount} />
          <OutdatedGroup count={groups.unplaced.length}>
            {groups.unplaced.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                active={thread.id === activeThreadId}
                onActivate={onActivate}
              />
            ))}
          </OutdatedGroup>
          {groups.placed.map((thread) => (
            <ThreadCard key={thread.id} thread={thread} active={thread.id === activeThreadId} onActivate={onActivate} />
          ))}
        </div>
      </aside>
    </div>
  );
}

export function ThreadsBadge({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Show ${count} threads`}
      className="flex h-8 items-center gap-2 rounded-button border border-line-soft px-3 text-meta font-medium text-ink-64 transition-colors duration-150 hover:border-line hover:text-ink"
    >
      <MessagesSquare className="size-3.5" strokeWidth={2} aria-hidden />
      Threads
      <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold text-accent-ink tabular-nums">
        {count}
      </span>
    </button>
  );
}
