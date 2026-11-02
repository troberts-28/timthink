import { describe, expect, it } from "vitest";
import { type CheckInput, checkDoc } from "./checkDoc.js";

const existing = new Set(["/docs/acme/prototype.html", "/docs/acme/sibling.md", "/docs/acme/data/sample.json"]);

function input(raw: string, overrides: Partial<CheckInput> = {}): CheckInput {
  return {
    raw,
    docFile: "/docs/acme/plan.md",
    fileExists: async (absolute) => existing.has(absolute),
    parseMermaid: async (code) => (code.includes("-->") ? null : { line: 2, message: "Expecting an arrow" }),
    ...overrides,
  };
}

async function problems(raw: string, overrides: Partial<CheckInput> = {}) {
  return (await checkDoc(input(raw, overrides))).problems.map(
    ({ line, severity, message }) => `${line} ${severity} ${message}`,
  );
}

describe("checkDoc", () => {
  it("passes a well-formed plan", async () => {
    const raw = [
      "---",
      "title: Feed",
      "status: review",
      "pr: 19388",
      "date: 2026-11-02",
      "---",
      "# Feed",
      "",
      "See [the sibling](sibling.md#intro), [data](./data/sample.json) and [docs](https://example.com).",
      "",
      "```question id=gate",
      "Gate it?",
      "- Yes (recommended)",
      "- No",
      "```",
      "",
      "```mermaid",
      "flowchart LR",
      "  A --> B",
      "```",
      "",
      "```demo src=prototype.html",
      "```",
      "",
      "`[not a link](missing.md)`",
    ].join("\n");
    expect(await problems(raw)).toEqual([]);
  });

  it("reports malformed YAML with its line", async () => {
    expect(await problems("---\ntitle: Feed\nrepos: [a\n---\n# Feed\n")).toEqual([
      expect.stringMatching(/^3 error Malformed frontmatter: /),
    ]);
  });

  it("validates known frontmatter fields", async () => {
    expect(await problems("---\ntitle: Feed\nstatus: completed\npr: soon\ndate: next week\n---\n")).toEqual([
      "3 error status must be one of draft, review, approved, in-progress, done, abandoned (did you mean done?)",
      "4 error pr must be a pull request number",
      "5 warning date should be YYYY-MM-DD",
    ]);
  });

  it("validates question blocks", async () => {
    const raw = [
      "```question id=gate",
      "Gate it?",
      "- Yes (recommended)",
      "- No (recommended)",
      "```",
      "```question id=gate",
      "Again?",
      "- Only one",
      "```",
      "```question",
      "No id",
      "- a",
      "- b",
      "```",
    ].join("\n");
    expect(await problems(raw)).toEqual([
      "1 error mark at most one option (recommended)",
      '6 error question id "gate" is already used on line 1',
      "6 error question block needs at least two `- option` lines",
      "10 error question block needs an id (```question id=some-id)",
    ]);
  });

  it("maps mermaid parse errors onto doc lines, or skips with a note when no parser is available", async () => {
    const raw = "# Plan\n\n```mermaid\nflowchart LR\n  A B\n```\n";
    expect(await problems(raw)).toEqual(["5 error mermaid: Expecting an arrow"]);
    const skipped = await checkDoc(input(raw, { parseMermaid: null }));
    expect(skipped.problems).toEqual([]);
    expect(skipped.notes).toEqual(["Skipped 1 mermaid diagram(s): the mermaid parser isn't available."]);
  });

  it("checks demo sources, relative links and unclosed fences", async () => {
    const raw = [
      "```demo src=missing.html",
      "```",
      "A [broken link](2026-01-01-gone.md), ![img](diagrams/none.png), [code](src/app.ts) and [tpl]({termsUrl}).",
      "[ref]: ../acme/also-gone.md",
      "```ts",
      "const x = 1;",
    ].join("\n");
    expect(await problems(raw)).toEqual([
      "1 error demo src missing.html doesn't exist",
      "3 error link target 2026-01-01-gone.md doesn't exist",
      "3 error link target diagrams/none.png doesn't exist",
      "4 error link target ../acme/also-gone.md doesn't exist",
      "5 error code fence is never closed",
    ]);
  });
});
