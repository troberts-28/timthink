import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_DOCS, FIXTURE_QUESTION_DOCS } from "../test/fixtures.js";
import { parseInfoString, scanFences } from "./fences.js";
import { detailsSections, parseQuestionBlock } from "./questionBlock.js";

const RICH_BLOCK = [
  "Should writes to the activity table be gated?",
  "- Gate behind `release_activity_feed`",
  "  Safer rollout, but history only starts",
  "  when the flag flips.",
  "- Dark-write from day one (recommended)",
  "  History builds up before the UI ships.",
  "---",
  "### Context",
  "The feed reads `src/feed/activity.ts:42`.",
  "",
  "### Options",
  "- **Gate it.** Slower.",
  "",
  "### Recommendation",
  "Dark-write.",
].join("\n");

async function fixtureQuestionBlocks(root: string): Promise<string[]> {
  const files = await readdir(root, { recursive: true });
  const blocks: string[] = [];
  for (const file of files.filter((name) => name.endsWith(".md")).sort()) {
    const raw = await readFile(path.join(root, file), "utf8");
    for (const fence of scanFences(raw).filter((candidate) => candidate.lang === "question")) {
      blocks.push(fence.content);
    }
  }
  return blocks;
}

describe("parseQuestionBlock", () => {
  it("splits the prompt from the options", () => {
    const block = parseQuestionBlock("Should writes be gated?\n- Gate behind `flag`\n- Dark-write (recommended)\n", {
      id: "activity-gate",
    });
    expect(block).toEqual({
      id: "activity-gate",
      prompt: "Should writes be gated?",
      options: [
        { label: "Gate behind `flag`", summary: null, recommended: false },
        { label: "Dark-write", summary: null, recommended: true },
      ],
      details: null,
    });
  });

  it("reads indented continuation lines as the option's summary", () => {
    const block = parseQuestionBlock(RICH_BLOCK, { id: "activity-gate" });
    expect(block.options).toEqual([
      {
        label: "Gate behind `release_activity_feed`",
        summary: "Safer rollout, but history only starts when the flag flips.",
        recommended: false,
      },
      { label: "Dark-write from day one", summary: "History builds up before the UI ships.", recommended: true },
    ]);
  });

  it("splits everything after a --- line into details, with its offset in the block", () => {
    const { details, options } = parseQuestionBlock(RICH_BLOCK, {});
    expect(options).toHaveLength(2);
    expect(details?.markdown.startsWith("### Context\n")).toBe(true);
    expect(details?.markdown.endsWith("Dark-write.")).toBe(true);
    expect(RICH_BLOCK.slice(details?.offset)).toBe(details?.markdown);
    expect(RICH_BLOCK.split("\n")[details?.lineIndex ?? -1]).toBe("### Context");
  });

  it("never reads lists in the details as options", () => {
    const block = parseQuestionBlock("Pick?\n- A\n- B\n---\n- not an option\n  nor a summary\n", {});
    expect(block.options.map((option) => option.label)).toEqual(["A", "B"]);
    expect(block.options.every((option) => option.summary === null)).toBe(true);
  });

  it("treats an empty details section as none", () => {
    expect(parseQuestionBlock("Pick?\n- A\n- B\n---\n\n", {}).details).toBeNull();
  });

  it("parses every legacy fixture block as before: no summaries, no details, labels without the marker", async () => {
    const blocks = [
      ...(await fixtureQuestionBlocks(FIXTURE_DOCS)),
      ...(await fixtureQuestionBlocks(FIXTURE_QUESTION_DOCS)),
    ];
    const legacy = blocks.filter((block) => !block.includes("\n---"));
    expect(legacy.length).toBeGreaterThan(0);
    for (const code of legacy) {
      const block = parseQuestionBlock(code, parseInfoString(""));
      const optionLines = code.split("\n").filter((line) => /^\s*[-*+]\s/.test(line));
      expect(block.options.map((option) => option.label)).toEqual(
        optionLines.map((line) =>
          line
            .replace(/^\s*[-*+]\s+/, "")
            .replace(/\s*\(recommended\)\s*$/i, "")
            .trim(),
        ),
      );
      expect(block.options.every((option) => option.summary === null)).toBe(true);
      expect(block.details).toBeNull();
    }
  });

  it("parses the rich fixture's summaries, recommendation and details sections", async () => {
    const rich = (await fixtureQuestionBlocks(FIXTURE_QUESTION_DOCS)).filter((block) => block.includes("\n---"));
    expect(rich).toHaveLength(3);
    for (const code of rich) {
      const block = parseQuestionBlock(code, {});
      expect(block.options.every((option) => option.summary)).toBe(true);
      expect(block.options.filter((option) => option.recommended)).toHaveLength(1);
      expect(detailsSections(block.details?.markdown ?? "")).toEqual(["context", "options", "recommendation"]);
    }
  });
});

describe("detailsSections", () => {
  it("finds the known section headings, ignoring headings inside code fences", () => {
    expect(detailsSections("### Context\n```md\n### Recommendation\n```\n## Options:\n#### Something else\n")).toEqual([
      "context",
      "options",
    ]);
    expect(detailsSections("### **Recommendation**\nDo it.")).toEqual(["recommendation"]);
  });
});
