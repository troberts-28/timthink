import type { ThreadKind } from "@timthink/server";
import { MessageSquarePlus, PencilLine } from "lucide-react";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { isTypingTarget } from "../lib/useKeyboardNav";
import { COMPOSER_WIDTH_PX, Composer } from "./Composer";
import { type HighlightGroups, HighlightLayer } from "./highlights";
import { useRequiredReview } from "./ReviewContext";
import { domRangeToSource, sourceToDomRange } from "./selectionMap";

const TOOLBAR_OFFSET_PX = 44;
const COMPOSER_GAP_PX = 10;
const EDGE_PADDING_PX = 8;
const TALL_RANGE_PX = 160;

interface ToolbarState {
  start: number;
  end: number;
  top: number;
  left: number;
}

interface SelectionLayerProps {
  body: HTMLElement | null;
  containerRef: RefObject<HTMLDivElement | null>;
  ranges: ReadonlyMap<string, Range>;
  layoutVersion: number;
}

function currentSelectionRange(body: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  return body.contains(range.commonAncestorContainer) ? range : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function useSelectionToolbar(body: HTMLElement | null, containerRef: RefObject<HTMLDivElement | null>, raw: string) {
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const measure = useCallback((): ToolbarState | null => {
    const container = containerRef.current;
    const range = body ? currentSelectionRange(body) : null;
    if (!body || !container || !range) return null;
    const mapped = domRangeToSource(body, raw, range);
    if (!mapped) return null;
    const origin = container.getBoundingClientRect();
    const first = range.getClientRects()[0] ?? range.getBoundingClientRect();
    return {
      ...mapped,
      top: first.top - origin.top - TOOLBAR_OFFSET_PX,
      left: clamp(first.left - origin.left, EDGE_PADDING_PX, origin.width - 220),
    };
  }, [body, containerRef, raw]);

  useEffect(() => {
    const update = () => window.setTimeout(() => setToolbar(measure()), 0);
    const onSelectionChange = () => {
      if (window.getSelection()?.isCollapsed) setToolbar(null);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey || event.key === "Shift") update();
    };
    document.addEventListener("mouseup", update);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("mouseup", update);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [measure]);

  return { toolbar, setToolbar, measure };
}

function useComposerPosition(
  body: HTMLElement | null,
  containerRef: RefObject<HTMLDivElement | null>,
  raw: string,
  span: { start: number; end: number } | null,
  layoutVersion: number,
) {
  const [state, setState] = useState<{ range: Range; top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const range = span && body ? sourceToDomRange(body, raw, span.start, span.end) : null;
    if (!container || !range || layoutVersion < 0) {
      setState(null);
      return;
    }
    const origin = container.getBoundingClientRect();
    const rects = Array.from(range.getClientRects());
    const bounds = range.getBoundingClientRect();
    const anchor = (bounds.height > TALL_RANGE_PX ? rects[0] : rects.at(-1)) ?? bounds;
    setState({
      range,
      top: anchor.bottom - origin.top + COMPOSER_GAP_PX,
      left: clamp(anchor.left - origin.left, 0, origin.width - COMPOSER_WIDTH_PX),
    });
  }, [body, containerRef, raw, span, layoutVersion]);
  return state;
}

export function SelectionLayer({ body, containerRef, ranges, layoutVersion }: SelectionLayerProps) {
  const { raw, review, composer, openComposer, closeComposer, activeThreadId, anchorsCurrent } = useRequiredReview();
  const { toolbar, setToolbar, measure } = useSelectionToolbar(body, containerRef, raw);
  const composerSpan = useMemo(() => (composer ? { start: composer.start, end: composer.end } : null), [composer]);
  const composerPosition = useComposerPosition(body, containerRef, raw, composerSpan, layoutVersion);

  const startThread = useCallback(
    (kind: ThreadKind, state: ToolbarState | null) => {
      if (!state) return;
      openComposer({ kind, start: state.start, end: state.end });
      setToolbar(null);
      window.getSelection()?.removeAllRanges();
    },
    [openComposer, setToolbar],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key === "c" || event.key === "s") {
        const state = toolbar ?? measure();
        if (state) {
          event.preventDefault();
          startThread(event.key === "c" ? "comment" : "suggestion", state);
        }
      }
      if (event.key === "Escape") {
        setToolbar(null);
        closeComposer();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toolbar, measure, startThread, setToolbar, closeComposer]);

  const groups = useMemo<HighlightGroups>(() => {
    if (!anchorsCurrent) return { "tt-pending": composerPosition ? [composerPosition.range] : [] };
    const open = (review?.threads ?? []).filter((thread) => thread.status === "open" && thread.id !== activeThreadId);
    const active = activeThreadId ? ranges.get(activeThreadId) : undefined;
    return {
      "tt-thread": open.flatMap((thread) => ranges.get(thread.id) ?? []),
      "tt-thread-active": active ? [active] : [],
      "tt-pending": composerPosition ? [composerPosition.range] : [],
    };
  }, [anchorsCurrent, review, ranges, activeThreadId, composerPosition]);

  return (
    <>
      <HighlightLayer groups={groups} containerRef={containerRef} layoutVersion={layoutVersion} />
      {toolbar && !composer ? (
        <div
          role="toolbar"
          aria-label="Comment on selection"
          className="selection-toolbar absolute z-30 flex items-center gap-0.5 rounded-button border border-line bg-surface-raised p-1 shadow-pop"
          style={{ top: toolbar.top, left: toolbar.left }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" className="toolbar-button" onClick={() => startThread("comment", toolbar)}>
            <MessageSquarePlus className="size-3.5" aria-hidden />
            Comment
          </button>
          <span className="h-4 w-px bg-line-soft" aria-hidden />
          <button type="button" className="toolbar-button" onClick={() => startThread("suggestion", toolbar)}>
            <PencilLine className="size-3.5" aria-hidden />
            Suggest edit
          </button>
        </div>
      ) : null}
      {composer && composerPosition ? (
        <Composer
          key={`${composer.start}-${composer.end}-${composer.kind}`}
          request={composer}
          position={composerPosition}
        />
      ) : null}
    </>
  );
}
