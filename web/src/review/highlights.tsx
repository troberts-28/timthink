import { type RefObject, useEffect, useLayoutEffect, useState } from "react";

export type HighlightName = "tt-thread" | "tt-thread-active" | "tt-pending" | "tt-diff-insert";

export type HighlightGroups = Partial<Record<HighlightName, readonly Range[]>>;

export const REVIEW_HIGHLIGHTS: readonly HighlightName[] = ["tt-thread", "tt-thread-active", "tt-pending"];

const PRIORITIES: Partial<Record<HighlightName, number>> = { "tt-diff-insert": -1 };

export function supportsCustomHighlights(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function";
}

function useCssHighlights(groups: HighlightGroups, names: readonly HighlightName[], enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    for (const name of names) {
      const ranges = groups[name] ?? [];
      if (ranges.length === 0) {
        CSS.highlights.delete(name);
        continue;
      }
      const highlight = new Highlight(...ranges);
      highlight.priority = PRIORITIES[name] ?? 0;
      CSS.highlights.set(name, highlight);
    }
    return () => {
      for (const name of names) CSS.highlights.delete(name);
    };
  }, [groups, names, enabled]);
}

interface OverlayRect {
  key: string;
  name: HighlightName;
  top: number;
  left: number;
  width: number;
  height: number;
}

function overlayRects(groups: HighlightGroups, names: readonly HighlightName[], container: HTMLElement): OverlayRect[] {
  const origin = container.getBoundingClientRect();
  return names.flatMap((name) =>
    (groups[name] ?? []).flatMap((range, rangeIndex) =>
      Array.from(range.getClientRects()).map((rect, rectIndex) => ({
        key: `${name}-${rangeIndex}-${rectIndex}`,
        name,
        top: rect.top - origin.top,
        left: rect.left - origin.left,
        width: rect.width,
        height: rect.height,
      })),
    ),
  );
}

interface HighlightLayerProps {
  groups: HighlightGroups;
  names?: readonly HighlightName[];
  containerRef: RefObject<HTMLElement | null>;
  layoutVersion: number;
}

export function HighlightLayer({
  groups,
  names = REVIEW_HIGHLIGHTS,
  containerRef,
  layoutVersion,
}: HighlightLayerProps) {
  const native = supportsCustomHighlights();
  useCssHighlights(groups, names, native);
  const [rects, setRects] = useState<OverlayRect[]>([]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (native || !container || layoutVersion < 0) return;
    setRects(overlayRects(groups, names, container));
  }, [groups, names, containerRef, native, layoutVersion]);
  if (native) return null;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {rects.map((rect) => (
        <div
          key={rect.key}
          className={`highlight-fallback highlight-fallback-${rect.name}`}
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      ))}
    </div>
  );
}
