import type { Thread } from "@timthink/server";
import { type MouseEvent, type ReactNode, type RefObject, useCallback, useMemo, useRef, useState } from "react";
import { useKeyShortcut } from "../lib/shortcuts";
import { PendingReviewBar } from "./PendingReviewBar";
import { useRequiredReview } from "./ReviewContext";
import { highlightSpan } from "./reviewModel";
import { SelectionLayer } from "./SelectionLayer";
import { SubmitReviewDialog } from "./SubmitReviewDialog";
import { ThreadDrawer, ThreadsBadge } from "./ThreadDrawer";
import { ThreadMargin } from "./ThreadMargin";
import { useClaudeActivityToasts } from "./useClaudeActivityToasts";
import { caretAt, type SourceAnchor, useAnchoredRanges, useDomVersion, useMediaQuery } from "./useDomGeometry";

const WIDE_LAYOUT_QUERY = "(min-width: 1280px)";

function threadAtPoint(ranges: ReadonlyMap<string, Range>, node: Node, offset: number): string | null {
  let best: { id: string; length: number } | null = null;
  for (const [id, range] of ranges) {
    try {
      if (!range.isPointInRange(node, offset)) continue;
    } catch {
      continue;
    }
    const length = range.toString().length;
    if (!best || length < best.length) best = { id, length };
  }
  return best?.id ?? null;
}

export function steppedThreadId(
  threads: readonly Thread[],
  ranges: ReadonlyMap<string, Range>,
  activeId: string | null,
  step: 1 | -1,
): string | null {
  const order = threads
    .filter((thread) => thread.status === "open" && ranges.has(thread.id))
    .sort((a, b) => a.anchor.start - b.anchor.start)
    .map((thread) => thread.id);
  if (order.length === 0) return null;
  const current = activeId ? order.indexOf(activeId) : -1;
  if (current === -1) return (step === 1 ? order[0] : order.at(-1)) ?? null;
  return order[(current + step + order.length) % order.length] ?? null;
}

function scrollToRange(range: Range | undefined): void {
  const target = range?.startContainer.parentElement;
  target?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export interface OverlaySlots {
  body: HTMLElement | null;
  containerRef: RefObject<HTMLDivElement | null>;
  layoutVersion: number;
}

interface ReviewWorkspaceProps {
  renderPaper: (slots: { bodyRef: (element: HTMLDivElement | null) => void; headerActions: ReactNode }) => ReactNode;
  headerActions: ReactNode;
  renderOverlay?: (slots: OverlaySlots) => ReactNode;
}

export function ReviewWorkspace({ renderPaper, headerActions, renderOverlay }: ReviewWorkspaceProps) {
  const { review, raw, activeThreadId, setActiveThreadId, anchorsCurrent, openSubmit } = useRequiredReview();
  useClaudeActivityToasts(review);
  const wide = useMediaQuery(WIDE_LAYOUT_QUERY);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const attachColumn = useCallback((element: HTMLDivElement | null) => {
    columnRef.current = element;
    setColumn(element);
  }, []);
  const domVersion = useDomVersion(body, column);
  const anchors = useMemo<SourceAnchor[]>(
    () =>
      anchorsCurrent
        ? (review?.threads ?? [])
            .filter((thread) => thread.status !== "outdated")
            .map((thread) => ({
              id: thread.id,
              ...highlightSpan(thread.anchor.quote, thread.anchor.start, thread.anchor.end),
            }))
        : [],
    [review, anchorsCurrent],
  );
  const ranges = useAnchoredRanges(body, raw, anchors, domVersion);
  const openCount = (review?.threads ?? []).filter((thread) => thread.status === "open").length;
  const marginVisible = wide && openCount > 0;

  const activateFromCard = useCallback(
    (thread: Thread) => {
      setActiveThreadId(thread.id);
      if (!marginVisible) scrollToRange(ranges.get(thread.id));
    },
    [setActiveThreadId, marginVisible, ranges],
  );

  const stepThread = (step: 1 | -1) => {
    const id = steppedThreadId(review?.threads ?? [], ranges, activeThreadId, step);
    if (!id) return;
    setActiveThreadId(id);
    scrollToRange(ranges.get(id));
  };
  useKeyShortcut("n", () => stepThread(1));
  useKeyShortcut("p", () => stepThread(-1));
  useKeyShortcut("r", () => openSubmit());
  useKeyShortcut("a", () => openSubmit("approve"));

  const onBodyClick = (event: MouseEvent) => {
    if (!window.getSelection()?.isCollapsed) return;
    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, summary")) return;
    const caret = caretAt(event.clientX, event.clientY);
    const id = caret ? threadAtPoint(ranges, caret.node, caret.offset) : null;
    setActiveThreadId(id);
    if (id && !marginVisible) setDrawerOpen(true);
  };

  const badge =
    !marginVisible && (review?.threads.length ?? 0) > 0 ? (
      <ThreadsBadge count={openCount} onClick={() => setDrawerOpen(true)} />
    ) : null;

  return (
    <div
      className={`grid grid-cols-1 gap-8 px-6 pt-8 pb-24 lg:px-8 ${
        marginVisible ? "paper-with-margin grid-cols-[minmax(0,1fr)_300px] pr-6" : "paper-full"
      }`}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: clicking a highlight is a pointer shortcut; every thread is reachable from its card. */}
      <div ref={attachColumn} className="relative min-w-0" onClick={onBodyClick}>
        {renderPaper({
          bodyRef: setBody,
          headerActions: (
            <>
              {headerActions}
              {badge}
            </>
          ),
        })}
        {renderOverlay?.({ body, containerRef: columnRef, layoutVersion: domVersion })}
        <SelectionLayer body={body} containerRef={columnRef} ranges={ranges} layoutVersion={domVersion} />
        <PendingReviewBar />
      </div>
      {marginVisible ? (
        <aside aria-label="Review threads" className="min-w-0">
          <ThreadMargin ranges={ranges} layoutVersion={domVersion} onActivate={activateFromCard} />
        </aside>
      ) : (
        <ThreadDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ranges={ranges}
          onActivate={activateFromCard}
        />
      )}
      <SubmitReviewDialog />
    </div>
  );
}
