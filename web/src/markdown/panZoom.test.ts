import { describe, expect, it } from "vitest";
import { fitView, MAX_ZOOM, MIN_ZOOM, panBy, zoomAt } from "./panZoom";

describe("diagram pan and zoom", () => {
  it("fits a wide diagram to the viewport width and centres it", () => {
    const view = fitView({ width: 2000, height: 400 }, { width: 1064, height: 800 });
    expect(view.scale).toBeCloseTo(0.5);
    expect(view.x).toBeCloseTo(32);
    expect(view.y).toBeCloseTo(300);
  });

  it("does not blow a small diagram up past twice its natural size", () => {
    expect(fitView({ width: 100, height: 100 }, { width: 1600, height: 900 }).scale).toBe(2);
  });

  it("keeps the point under the cursor fixed while zooming", () => {
    const view = { scale: 1, x: 40, y: 20 };
    const anchor = { x: 300, y: 200 };
    const zoomed = zoomAt(view, 2, anchor);
    const contentPointBefore = { x: (anchor.x - view.x) / view.scale, y: (anchor.y - view.y) / view.scale };
    const contentPointAfter = { x: (anchor.x - zoomed.x) / zoomed.scale, y: (anchor.y - zoomed.y) / zoomed.scale };
    expect(zoomed.scale).toBe(2);
    expect(contentPointAfter.x).toBeCloseTo(contentPointBefore.x);
    expect(contentPointAfter.y).toBeCloseTo(contentPointBefore.y);
  });

  it("stops zooming at the limits without drifting", () => {
    const atMax = { scale: MAX_ZOOM, x: 10, y: 10 };
    expect(zoomAt(atMax, 2, { x: 500, y: 500 })).toEqual(atMax);
    expect(zoomAt({ scale: MIN_ZOOM * 1.5, x: 0, y: 0 }, 0.1, { x: 0, y: 0 }).scale).toBe(MIN_ZOOM);
  });

  it("pans without changing the zoom", () => {
    expect(panBy({ scale: 1.5, x: 10, y: 10 }, { x: -30, y: 5 })).toEqual({ scale: 1.5, x: -20, y: 15 });
  });
});
