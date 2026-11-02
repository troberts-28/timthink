import { useEffect, useLayoutEffect, useState } from "react";
import { sourceToDomRange } from "./selectionMap";

export function useDomVersion(element: HTMLElement | null, resizeRoot: HTMLElement | null = null): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!element) return;
    let frame = 0;
    const bump = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setVersion((current) => current + 1);
        });
      }
    };
    const mutations = new MutationObserver(bump);
    mutations.observe(element, { childList: true, subtree: true, characterData: true });
    const resizes = new ResizeObserver(bump);
    resizes.observe(element);
    if (resizeRoot) resizes.observe(resizeRoot);
    window.addEventListener("resize", bump);
    void document.fonts?.ready.then(bump);
    return () => {
      mutations.disconnect();
      resizes.disconnect();
      window.removeEventListener("resize", bump);
      cancelAnimationFrame(frame);
    };
  }, [element, resizeRoot]);
  return version;
}

export interface SourceAnchor {
  id: string;
  start: number;
  end: number;
}

export function useAnchoredRanges(
  root: HTMLElement | null,
  raw: string,
  anchors: readonly SourceAnchor[],
  domVersion: number,
): ReadonlyMap<string, Range> {
  const [ranges, setRanges] = useState<ReadonlyMap<string, Range>>(new Map());
  // biome-ignore lint/correctness/useExhaustiveDependencies: domVersion signals that the rendered DOM under root changed.
  useLayoutEffect(() => {
    const next = new Map<string, Range>();
    if (root) {
      for (const anchor of anchors) {
        const range = sourceToDomRange(root, raw, anchor.start, anchor.end);
        if (range) next.set(anchor.id, range);
      }
    }
    setRanges(next);
  }, [root, raw, anchors, domVersion]);
  return ranges;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export interface CaretPoint {
  node: Node;
  offset: number;
}

export function caretAt(x: number, y: number): CaretPoint | null {
  if (typeof document.caretPositionFromPoint === "function") {
    const position = document.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}
