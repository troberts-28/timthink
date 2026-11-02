import { type RefObject, useLayoutEffect, useMemo, useState } from "react";
import { type HighlightGroups, HighlightLayer, type HighlightName } from "../review/highlights";
import { sourceToDomRange } from "../review/selectionMap";
import { deletionLabel } from "./blockDiff";
import { blockElements, verticalSpan } from "./blockGeometry";
import { useChanges } from "./ChangesContext";

const DIFF_HIGHLIGHTS: readonly HighlightName[] = ["tt-diff-insert"];
const GUTTER_OFFSET_PX = 24;
const WHITESPACE = /\s/;

interface GutterBar {
  key: string;
  kind: "changed" | "added";
  top: number;
  height: number;
}

interface DeletionMarker {
  key: string;
  label: string;
  top: number;
  left: number;
  height: number;
}

interface Layout {
  gutterLeft: number;
  bars: GutterBar[];
  markers: DeletionMarker[];
}

interface CaretBox {
  left: number;
  top: number;
  height: number;
}

function caretBox(root: HTMLElement, raw: string, at: number): CaretBox | null {
  let end = at;
  while (end < raw.length && WHITESPACE.test(raw[end] ?? "")) end += 1;
  const following = sourceToDomRange(root, raw, at, Math.min(raw.length, end + 1))?.getClientRects()[0];
  if (following) return { left: following.left, top: following.top, height: following.height };
  let start = at;
  while (start > 0 && WHITESPACE.test(raw[start - 1] ?? "")) start -= 1;
  const preceding = sourceToDomRange(root, raw, Math.max(0, start - 1), start)?.getClientRects();
  const last = preceding?.[preceding.length - 1];
  return last ? { left: last.right, top: last.top, height: last.height } : null;
}

interface ChangesLayerProps {
  body: HTMLElement | null;
  containerRef: RefObject<HTMLDivElement | null>;
  layoutVersion: number;
}

export function ChangesLayer({ body, containerRef, layoutVersion }: ChangesLayerProps) {
  const changes = useChanges();
  const active = changes?.showChanges ? changes.diff : null;
  const raw = changes?.raw ?? "";
  const [layout, setLayout] = useState<Layout | null>(null);

  const groups = useMemo<HighlightGroups>(() => {
    if (!active || !body || layoutVersion < 0) return {};
    const ranges = active.changes.flatMap((change) =>
      change.kind === "changed"
        ? change.insertions.flatMap((span) => sourceToDomRange(body, raw, span.start, span.end) ?? [])
        : [],
    );
    return { "tt-diff-insert": ranges };
  }, [active, body, raw, layoutVersion]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!active || !body || !container || layoutVersion < 0) {
      setLayout(null);
      return;
    }
    const origin = container.getBoundingClientRect();
    const bars = active.changes.flatMap((change): GutterBar[] => {
      const span = verticalSpan(blockElements(body, change.start, change.end), origin.top);
      return span
        ? [{ key: `${change.kind}-${change.start}`, kind: change.kind, top: span.top, height: span.bottom - span.top }]
        : [];
    });
    const markers = active.changes.flatMap((change) =>
      change.kind === "changed"
        ? change.deletions.flatMap((deletion): DeletionMarker[] => {
            const box = caretBox(body, raw, deletion.at);
            const label = deletionLabel(deletion.text);
            if (!box || !label) return [];
            return [
              {
                key: `${deletion.at}`,
                label,
                top: box.top - origin.top,
                left: box.left - origin.left,
                height: box.height,
              },
            ];
          })
        : [],
    );
    setLayout({ gutterLeft: body.getBoundingClientRect().left - origin.left - GUTTER_OFFSET_PX, bars, markers });
  }, [active, body, raw, containerRef, layoutVersion]);

  if (!active) return null;
  return (
    <>
      <HighlightLayer
        groups={groups}
        names={DIFF_HIGHLIGHTS}
        containerRef={containerRef}
        layoutVersion={layoutVersion}
      />
      {layout ? (
        <div className="pointer-events-none absolute inset-0 z-10" data-diff-layer>
          {layout.bars.map((bar) => (
            <span
              key={bar.key}
              className={`diff-bar diff-bar-${bar.kind}`}
              style={{ top: bar.top, height: bar.height, left: layout.gutterLeft }}
              title={bar.kind === "added" ? "New" : "Changed"}
            />
          ))}
          {layout.markers.map((marker) => (
            <span
              key={marker.key}
              className="diff-deletion"
              style={{ top: marker.top, left: marker.left, height: marker.height }}
            >
              <button type="button" className="diff-deletion-hit" aria-label={`Removed: ${marker.label}`} />
              <span className="diff-deletion-tip" role="tooltip">
                <span className="diff-deletion-kicker">Removed</span>
                <del>{marker.label}</del>
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}
