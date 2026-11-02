import type { Thread } from "@timthink/server";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type CardSlot, layoutCards } from "./layoutCards";
import { useRequiredReview } from "./ReviewContext";
import { ThreadCard } from "./ThreadCard";
import { OutdatedGroup, ThreadPanelHeader } from "./ThreadPanelHeader";
import { groupThreads } from "./threadGroups";

const HEADER_GAP_PX = 16;
const HIGHLIGHT_NUDGE_PX = 6;

function useCardHeights() {
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const observer = useMemo(
    () =>
      new ResizeObserver((entries) => {
        setHeights((current) => {
          let next: Map<string, number> | null = null;
          for (const entry of entries) {
            const id = entry.target instanceof HTMLElement ? entry.target.dataset.threadId : undefined;
            const height = Math.round(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
            if (id && current.get(id) !== height) {
              next ??= new Map(current);
              next.set(id, height);
            }
          }
          return next ?? current;
        });
      }),
    [],
  );
  useLayoutEffect(() => () => observer.disconnect(), [observer]);
  const measure = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) observer.observe(element);
    },
    [observer],
  );
  return { heights, measure };
}

interface ThreadMarginProps {
  ranges: ReadonlyMap<string, Range>;
  layoutVersion: number;
  onActivate: (thread: Thread) => void;
}

export function ThreadMargin({ ranges, layoutVersion, onActivate }: ThreadMarginProps) {
  const { review, activeThreadId, showResolved } = useRequiredReview();
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const { heights, measure } = useCardHeights();
  const [tops, setTops] = useState<ReadonlyMap<string, number>>(new Map());
  const [minHeight, setMinHeight] = useState(0);
  const groups = useMemo(() => groupThreads(review, ranges, showResolved), [review, ranges, showResolved]);
  const openCount = (review?.threads ?? []).filter((thread) => thread.status === "open").length;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || layoutVersion < 0) return;
    const origin = container.getBoundingClientRect().top;
    const minTop = (headerRef.current?.offsetHeight ?? 0) + HEADER_GAP_PX;
    const slots: CardSlot[] = groups.placed.flatMap((thread) => {
      const range = ranges.get(thread.id);
      const height = heights.get(thread.id);
      if (!range || height === undefined) return [];
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      return [{ id: thread.id, desiredTop: rect.top - origin - HIGHLIGHT_NUDGE_PX, height }];
    });
    const next = layoutCards(slots, activeThreadId, minTop);
    setTops(next);
    const bottom = Math.max(0, ...slots.map((slot) => (next.get(slot.id) ?? 0) + slot.height));
    setMinHeight(bottom);
  }, [groups, ranges, heights, activeThreadId, layoutVersion]);

  return (
    <div ref={containerRef} className="relative" style={{ minHeight }}>
      <div ref={headerRef} className="flex flex-col gap-3 pt-2">
        <ThreadPanelHeader openCount={openCount} resolvedCount={groups.resolvedCount} />
        <OutdatedGroup count={groups.unplaced.length}>
          {groups.unplaced.map((thread) => (
            <ThreadCard key={thread.id} thread={thread} active={thread.id === activeThreadId} onActivate={onActivate} />
          ))}
        </OutdatedGroup>
      </div>
      {groups.placed.map((thread) => {
        const top = tops.get(thread.id);
        return (
          <ThreadCard
            key={thread.id}
            ref={measure}
            thread={thread}
            active={thread.id === activeThreadId}
            onActivate={onActivate}
            className={`thread-slot ${top === undefined ? "is-measuring" : ""}`}
            style={{ top: top ?? 0 }}
          />
        );
      })}
    </div>
  );
}
