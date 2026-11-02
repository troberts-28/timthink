import { describe, expect, it } from "vitest";
import { svgNaturalSize, withoutFixedSize } from "./mermaidSize";

const SVG =
  '<svg id="m1" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: 1234.5px; background: red;" viewBox="-8 -8 1234.5 640"><rect width="10" height="10"/></svg>';

describe("mermaid sizing", () => {
  it("reads the natural size from the root viewBox", () => {
    expect(svgNaturalSize(SVG)).toEqual({ width: 1234.5, height: 640 });
    expect(svgNaturalSize("<svg><rect/></svg>")).toBeNull();
  });

  it("drops the root's fixed width and max-width but leaves children alone", () => {
    expect(withoutFixedSize(SVG)).toBe(
      '<svg id="m1" xmlns="http://www.w3.org/2000/svg" style="background: red;" viewBox="-8 -8 1234.5 640"><rect width="10" height="10"/></svg>',
    );
  });
});
