import { Scan, ZoomIn, ZoomOut } from "lucide-react";
import { type PointerEvent, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SvgSize } from "./mermaidSize";
import { type Box, fitView, type PanZoomView, type Point, panBy, zoomAt } from "./panZoom";

const BUTTON_ZOOM_STEP = 1.25;
const DOUBLE_CLICK_ZOOM_STEP = 2;
const WHEEL_ZOOM_SENSITIVITY = 0.01;
const MAX_WHEEL_ZOOM_DELTA = 25;
const WHEEL_LINE_PX = 16;
const KEY_PAN_PX = 80;

type ViewUpdate = (view: PanZoomView) => PanZoomView;

export function DiagramViewport({ svg, size }: { svg: string; size: SvgSize }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PanZoomView | null>(null);
  const userHasMoved = useRef(false);

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    userHasMoved.current = false;
    setView(fitView(size, measure(viewport)));
  }, [size]);

  const update = useCallback((next: ViewUpdate) => {
    userHasMoved.current = true;
    setView((current) => (current ? next(current) : current));
  }, []);

  const zoomAroundCentre = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const { width, height } = measure(viewport);
      update((current) => zoomAt(current, factor, { x: width / 2, y: height / 2 }));
    },
    [update],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    fit();
    const observer = new ResizeObserver(() => {
      if (!userHasMoved.current) fit();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fit]);

  useWheelPanZoom(viewportRef, update);
  useKeyboardPanZoom({ update, zoomAroundCentre, fit });
  const drag = useDragPan(update);

  return (
    <div className="mermaid-viewport-frame">
      <div
        ref={viewportRef}
        role="application"
        aria-label="Diagram canvas"
        className={`mermaid-viewport ${drag.isDragging ? "is-dragging" : ""}`}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerEnd}
        onPointerCancel={drag.onPointerEnd}
        onDoubleClick={(event) => {
          const anchor = pointIn(event.currentTarget, event);
          update((current) => zoomAt(current, DOUBLE_CLICK_ZOOM_STEP, anchor));
        }}
      >
        {view ? (
          <div
            className="mermaid-viewport-content"
            style={{
              width: size.width * view.scale,
              height: size.height * view.scale,
              transform: `translate(${view.x}px, ${view.y}px)`,
            }}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid output is sanitised with securityLevel "strict".
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : null}
      </div>
      <p className="mermaid-viewport-hint">Drag or scroll to pan · pinch, ⌘ scroll or double-click to zoom</p>
      <div className="mermaid-zoom-controls">
        <button
          type="button"
          onClick={() => zoomAroundCentre(1 / BUTTON_ZOOM_STEP)}
          aria-label="Zoom out"
          title="Zoom out (-)"
        >
          <ZoomOut className="size-4" aria-hidden />
        </button>
        <button type="button" className="mermaid-zoom-level" onClick={fit} title="Fit to screen (0)">
          {view ? `${Math.round(view.scale * 100)}%` : ""}
        </button>
        <button
          type="button"
          onClick={() => zoomAroundCentre(BUTTON_ZOOM_STEP)}
          aria-label="Zoom in"
          title="Zoom in (+)"
        >
          <ZoomIn className="size-4" aria-hidden />
        </button>
        <button type="button" onClick={fit} aria-label="Fit to screen" title="Fit to screen (0)">
          <Scan className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function useWheelPanZoom(viewportRef: RefObject<HTMLDivElement>, update: (next: ViewUpdate) => void) {
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unitPx = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : 1;
      if (event.ctrlKey || event.metaKey) {
        const anchor = pointIn(viewport, event);
        const zoomDelta = Math.max(-MAX_WHEEL_ZOOM_DELTA, Math.min(MAX_WHEEL_ZOOM_DELTA, event.deltaY * unitPx));
        const factor = Math.exp(-zoomDelta * WHEEL_ZOOM_SENSITIVITY);
        update((current) => zoomAt(current, factor, anchor));
        return;
      }
      update((current) => panBy(current, { x: -event.deltaX * unitPx, y: -event.deltaY * unitPx }));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [viewportRef, update]);
}

interface KeyboardPanZoomActions {
  update: (next: ViewUpdate) => void;
  zoomAroundCentre: (factor: number) => void;
  fit: () => void;
}

function useKeyboardPanZoom({ update, zoomAroundCentre, fit }: KeyboardPanZoomActions) {
  useEffect(() => {
    const pan = (delta: Point) => update((current) => panBy(current, delta));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case "+":
        case "=":
          zoomAroundCentre(BUTTON_ZOOM_STEP);
          break;
        case "-":
          zoomAroundCentre(1 / BUTTON_ZOOM_STEP);
          break;
        case "0":
          fit();
          break;
        case "ArrowLeft":
          pan({ x: KEY_PAN_PX, y: 0 });
          break;
        case "ArrowRight":
          pan({ x: -KEY_PAN_PX, y: 0 });
          break;
        case "ArrowUp":
          pan({ x: 0, y: KEY_PAN_PX });
          break;
        case "ArrowDown":
          pan({ x: 0, y: -KEY_PAN_PX });
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [update, zoomAroundCentre, fit]);
}

function useDragPan(update: (next: ViewUpdate) => void) {
  const lastPointer = useRef<Point | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  return {
    isDragging,
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      lastPointer.current = { x: event.clientX, y: event.clientY };
      setIsDragging(true);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const last = lastPointer.current;
      if (!last) return;
      const delta = { x: event.clientX - last.x, y: event.clientY - last.y };
      lastPointer.current = { x: event.clientX, y: event.clientY };
      update((current) => panBy(current, delta));
    },
    onPointerEnd() {
      lastPointer.current = null;
      setIsDragging(false);
    },
  };
}

function measure(element: HTMLElement): Box {
  return { width: element.clientWidth, height: element.clientHeight };
}

function pointIn(element: HTMLElement, event: { clientX: number; clientY: number }): Point {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
