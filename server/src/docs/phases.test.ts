import { describe, expect, it } from "vitest";
import { listPhases } from "./phases.js";

describe("listPhases", () => {
  it("counts each phase's tasks up to the next heading of the same level", () => {
    const body = [
      "## 8. Phases",
      "### Phase 0: verify",
      "- [x] checked",
      "### Phase 1: plan to build",
      "- [ ] skill",
      "- [x] hand-off",
      "#### Notes",
      "- [ ] nested task still counts",
      "## Later",
      "- [ ] not in a phase",
    ].join("\n");
    expect(listPhases(body)).toEqual([
      { number: 0, title: "verify", tasks: { done: 1, total: 1 } },
      { number: 1, title: "plan to build", tasks: { done: 1, total: 3 } },
    ]);
  });

  it("accepts bold or punctuated headings and ignores fenced examples", () => {
    const body = ["## **Phase 2** — display", "- [ ] strip", "```", "### Phase 9: fake", "```"].join("\n");
    expect(listPhases(body)).toEqual([{ number: 2, title: "display", tasks: { done: 0, total: 1 } }]);
  });

  it("returns nothing for a plan without phases", () => {
    expect(listPhases("# Plan\n- [ ] a task")).toEqual([]);
  });
});
