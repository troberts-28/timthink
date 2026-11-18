export interface Box {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PanZoomView {
  scale: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
const FIT_PADDING_PX = 32;
const FIT_MAX_UPSCALE = 2;

export function fitView(content: Box, viewport: Box): PanZoomView {
  const scale = clampZoom(
    Math.min(
      (viewport.width - 2 * FIT_PADDING_PX) / content.width,
      (viewport.height - 2 * FIT_PADDING_PX) / content.height,
      FIT_MAX_UPSCALE,
    ),
  );
  return {
    scale,
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
  };
}

export function zoomAt(view: PanZoomView, factor: number, anchor: Point): PanZoomView {
  const scale = clampZoom(view.scale * factor);
  const applied = scale / view.scale;
  return {
    scale,
    x: anchor.x - (anchor.x - view.x) * applied,
    y: anchor.y - (anchor.y - view.y) * applied,
  };
}

export function panBy(view: PanZoomView, delta: Point): PanZoomView {
  return { ...view, x: view.x + delta.x, y: view.y + delta.y };
}

function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}
