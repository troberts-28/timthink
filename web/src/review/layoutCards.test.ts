import { describe, expect, it } from "vitest";
import { layoutCards } from "./layoutCards";

const slots = [
  { id: "a", desiredTop: 100, height: 80 },
  { id: "b", desiredTop: 120, height: 60 },
  { id: "c", desiredTop: 400, height: 50 },
];

describe("layoutCards", () => {
  it("keeps cards level with their highlight and stacks overlaps downwards", () => {
    expect(Object.fromEntries(layoutCards(slots, null, 0, 10))).toEqual({ a: 100, b: 190, c: 400 });
  });

  it("gives the active card its exact spot and pushes earlier cards up", () => {
    expect(Object.fromEntries(layoutCards(slots, "b", 0, 10))).toEqual({ a: 30, b: 120, c: 400 });
  });

  it("never places cards above the minimum top", () => {
    const tops = layoutCards(slots, "b", 60, 10);
    expect(Math.min(...tops.values())).toBe(60);
    expect(tops.get("b")).toBe(150);
  });
});
