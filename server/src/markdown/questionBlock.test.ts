import { describe, expect, it } from "vitest";
import { parseQuestionBlock, splitRecommended } from "./questionBlock.js";

describe("parseQuestionBlock", () => {
  it("splits the prompt from the options", () => {
    const block = parseQuestionBlock("Should writes be gated?\n- Gate behind `flag`\n- Dark-write (recommended)\n", {
      id: "activity-gate",
    });
    expect(block).toEqual({
      id: "activity-gate",
      prompt: "Should writes be gated?",
      options: ["Gate behind `flag`", "Dark-write (recommended)"],
    });
    expect(splitRecommended(block.options[1] ?? "")).toEqual({ text: "Dark-write", recommended: true });
  });
});
