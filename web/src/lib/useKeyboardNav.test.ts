import { describe, expect, it } from "vitest";
import { type NavEntry, nextDocPath } from "./useKeyboardNav";

const order: NavEntry[] = [
  { path: "a.md", archived: false },
  { path: "b.md", archived: true },
  { path: "c.md", archived: false },
  { path: "d.md", archived: true },
];

describe("nextDocPath", () => {
  it("skips archived docs unless they are shown", () => {
    expect(nextDocPath(order, "a.md", 1)).toBe("c.md");
    expect(nextDocPath(order, "c.md", 1)).toBe("c.md");
  });

  it("moves on from an archived doc that is open", () => {
    expect(nextDocPath(order, "b.md", 1)).toBe("c.md");
    expect(nextDocPath(order, "b.md", -1)).toBe("a.md");
  });

  it("starts at either end when nothing is open", () => {
    expect(nextDocPath(order, null, 1)).toBe("a.md");
    expect(nextDocPath(order, null, -1)).toBe("c.md");
    expect(nextDocPath([], null, 1)).toBeNull();
  });
});
