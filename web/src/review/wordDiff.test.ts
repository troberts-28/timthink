import { describe, expect, it } from "vitest";
import { wordDiff } from "./wordDiff";

describe("wordDiff", () => {
  it("marks replaced words and keeps shared text", () => {
    expect(wordDiff("Start early, without a gate.", "Start early, behind a flag.")).toEqual([
      { kind: "same", text: "Start early, " },
      { kind: "removed", text: "without" },
      { kind: "added", text: "behind" },
      { kind: "same", text: " a " },
      { kind: "removed", text: "gate" },
      { kind: "added", text: "flag" },
      { kind: "same", text: "." },
    ]);
  });

  it("handles pure insertions and deletions", () => {
    expect(wordDiff("", "new")).toEqual([{ kind: "added", text: "new" }]);
    expect(wordDiff("old text", "")).toEqual([{ kind: "removed", text: "old text" }]);
    expect(wordDiff("same", "same")).toEqual([{ kind: "same", text: "same" }]);
  });
});
