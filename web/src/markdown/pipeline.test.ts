import type { Element, ElementContent, Root } from "hast";
import { describe, expect, it } from "vitest";
import { markdownToHast } from "./pipeline";

const options = {
  github: { owner: "acme", repo: "api" },
  prLinks: "graphite" as const,
  docPath: "acme/plans/2026-10-01-plan.md",
  repoDocPaths: ["acme/plans/2026-10-01-plan.md", "acme/plans/2026-09-01-older.md", "acme/2026-09-01-older.md"],
};

function elements(node: Root | ElementContent): Element[] {
  if (node.type !== "root" && node.type !== "element") return [];
  const own = node.type === "element" ? [node] : [];
  return [...own, ...node.children.flatMap((child) => (child.type === "doctype" ? [] : elements(child)))];
}

function render(markdown: string): Element[] {
  return elements(markdownToHast(markdown, options).hast);
}

describe("markdownToHast", () => {
  it("strips frontmatter and the leading title, and collects a TOC", () => {
    const { hast, toc } = markdownToHast("---\ntitle: x\n---\n# Title\n\n## First part\n\n### Detail\n", options);
    const tags = elements(hast).map((node) => node.tagName);
    expect(tags).not.toContain("h1");
    expect(toc).toEqual([
      { id: "first-part", text: "First part", depth: 2 },
      { id: "detail", text: "Detail", depth: 3 },
    ]);
  });

  it("marks code paths in inline code but not in fenced code", () => {
    const nodes = render("Edit `src/a.ts:42` and `not a path`.\n\n```ts\nsrc/b.ts\n```\n");
    const refs = nodes.filter((node) => node.properties.dataCodeRef !== undefined);
    expect(refs.map((node) => node.properties.dataCodeRef)).toEqual(["src/a.ts:42"]);
  });

  it("links PR references in prose but never inside code", () => {
    const nodes = render("Ships in #4211, see `#4212` and https://github.com/acme/api/pull/4213.");
    const hrefs = nodes.filter((node) => node.tagName === "a").map((node) => node.properties.href);
    expect(hrefs).toEqual([
      "https://app.graphite.com/github/pr/acme/api/4211",
      "https://app.graphite.com/github/pr/acme/api/4213",
    ]);
  });

  it("links sibling plans in text and inline code, preferring the same folder", () => {
    const nodes = render("After 2026-09-01-older.md and `2026-09-01-older.md` and `nope.md`.");
    const planLinks = nodes.filter((node) => node.properties.dataPlanRef !== undefined);
    expect(planLinks.map((node) => node.properties.href)).toEqual([
      "/d/acme/plans/2026-09-01-older.md",
      "/d/acme/plans/2026-09-01-older.md",
    ]);
  });

  it("turns fenced blocks into unwrapped fence containers with their info string", () => {
    const markdown = "```question id=burst\nWhich?\n- A\n- B\n```\n";
    const nodes = render(markdown);
    const fence = nodes.find((node) => node.properties.dataFence !== undefined);
    expect(fence?.properties).toMatchObject({
      dataFence: "question",
      dataMeta: "id=burst",
      dataS: 0,
      dataE: markdown.length - 1,
    });
    expect(nodes.some((node) => node.tagName === "pre")).toBe(false);
  });

  it("detects callouts", () => {
    const quotes = render("> **Note** be careful\n\n> [!WARNING]\n> really\n\n> plain").filter(
      (node) => node.tagName === "blockquote",
    );
    expect(quotes.map((node) => node.properties.dataCallout)).toEqual(["note", "warning", undefined]);
  });

  it("keeps source offsets on blocks and text runs", () => {
    const markdown = "Intro paragraph.\n\n- item **bold** text\n";
    const nodes = render(markdown);
    const paragraph = nodes.find((node) => node.tagName === "p");
    expect(paragraph?.properties).toMatchObject({ dataS: 0, dataE: 16 });
    const spans = nodes.filter((node) => node.tagName === "span");
    const sliced = spans.map((node) => markdown.slice(Number(node.properties.dataS), Number(node.properties.dataE)));
    expect(sliced).toEqual(["Intro paragraph.", "item ", "bold", " text"]);
  });

  it("keeps offsets on text split around auto links", () => {
    const markdown = "See PR 4211 now";
    const spans = render(markdown).filter((node) => node.tagName === "span");
    const sliced = spans.map((node) => markdown.slice(Number(node.properties.dataS), Number(node.properties.dataE)));
    expect(sliced).toEqual(["See ", "PR 4211", " now"]);
  });
});
