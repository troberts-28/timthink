import { readFileSync } from "node:fs";
import type { ElementContent, Element as HastElement, Root } from "hast";
import { toHtml } from "hast-util-to-html";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import { codeBlockHast } from "../markdown/codeBlockHast";
import { highlightToHast } from "../markdown/highlight";
import { markdownToHast } from "../markdown/pipeline";
import { align, domRangeToSource, sourceToDomRange } from "./selectionMap";

const source = readFileSync(new URL("./__fixtures__/selection.md", import.meta.url), "utf8");
const options = { github: null, prLinks: "graphite" as const, docPath: "repo/plan.md", repoDocPaths: [] };
let doc: Document;
let root: Element;

function isCodeFence(node: ElementContent): node is HastElement {
  return node.type === "element" && typeof node.properties.dataFence === "string";
}

async function renderLikeTheApp(markdown: string): Promise<string> {
  const { hast } = markdownToHast(markdown, options);
  const visit = async (parent: Root | HastElement): Promise<void> => {
    for (const child of parent.children) {
      if (child.type !== "element") continue;
      if (child.properties.dataFence === "question") {
        child.children = child.children.filter((node) => node.type === "element");
        await visit(child);
      } else if (isCodeFence(child)) {
        const code = child.children
          .map((node) => (node.type === "text" ? node.value : ""))
          .join("")
          .replace(/\n$/, "");
        const highlighted = await highlightToHast(code, String(child.properties.dataFence));
        const span = { start: Number(child.properties.dataCs), end: Number(child.properties.dataCe) };
        child.children = codeBlockHast(highlighted, code, span).children.filter((node) => node.type === "element");
      } else {
        await visit(child);
      }
    }
  };
  await visit(hast);
  return toHtml(hast);
}

beforeAll(async () => {
  doc = new JSDOM(`<main>${await renderLikeTheApp(source)}</main>`).window.document;
  const main = doc.querySelector("main");
  if (!main) throw new Error("no main");
  root = main;
});

function textNodes(): Text[] {
  const walker = doc.createTreeWalker(root, 4);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

function locate(index: number): [Node, number] {
  let remaining = index;
  for (const text of textNodes()) {
    if (remaining <= text.data.length) return [text, remaining];
    remaining -= text.data.length;
  }
  throw new Error("index out of range");
}

function selectRendered(needle: string): Range {
  const at = root.textContent?.indexOf(needle) ?? -1;
  if (at === -1) throw new Error(`not rendered: ${JSON.stringify(needle)}`);
  const range = doc.createRange();
  range.setStart(...locate(at));
  range.setEnd(...locate(at + needle.length));
  return range;
}

function roundTrip(range: Range): { quote: string; rendered: string } {
  const mapped = domRangeToSource(root, source, range);
  if (!mapped) throw new Error("selection did not map");
  const back = sourceToDomRange(root, source, mapped.start, mapped.end);
  return { quote: source.slice(mapped.start, mapped.end), rendered: back?.toString() ?? "" };
}

const cases: Array<[string, string, string]> = [
  ["plain text", "writing to it", "writing to it"],
  ["inside bold", "without a gate", "without a gate"],
  ["bold into plain", "a gate, so history", "a gate**, so history"],
  ["across a link", "See the docs and", "See [the docs](https://example.com) and"],
  ["inline code path", "web/src/Foo.tsx:42", "web/src/Foo.tsx:42"],
  ["heading with code", "Heading with code", "Heading with `code`"],
  ["entity", "Tom & Jerry", "Tom &amp; Jerry"],
  ["escaped chars", "*literal stars*", "\\*literal stars\\*"],
  ["table cell", "cell one", "cell one"],
  ["table cell with code and escaped pipe", "two | piped", "`two` \\| piped"],
  ["exactly the inline code keeps its delimiters out", "two", "two"],
  ["exactly the bold text", "early, without a gate", "early, without a gate"],
  ["plain into bold balances the closing delimiter", "it early, without a gate", "it **early, without a gate**"],
  ["nested list into continuation line", "bold\ncontinued", "**bold**\n    continued"],
  ["task list item", "task not done", "task not done"],
  ["blockquote across lines", "one\nquoted", "one\n> quoted"],
  ["highlighted code block across lines", "answer = 42\nconsole", "answer = 42\nconsole"],
  ["a single highlighted code token", "log", "log"],
  ["indented code block in a list", "test --run", "test --run"],
  ["across two paragraphs", "ends here.\nFinal paragraph two", "ends here.\n\nFinal paragraph two"],
  ["question details paragraph", "on every request", "on every **request**"],
  ["question details code path", "server/src/sessions.ts:12", "server/src/sessions.ts:12"],
  ["question details section heading", "Recommendation", "Recommendation"],
  ["question details recommendation", "revisit if restarts hurt", "revisit if restarts hurt"],
];

describe("domRangeToSource / sourceToDomRange", () => {
  it.each(cases)("%s", (_name, rendered, expectedQuote) => {
    const { quote, rendered: back } = roundTrip(selectRendered(rendered));
    expect(quote).toBe(expectedQuote);
    expect(back).toBe(rendered);
  });

  it("renders highlighted code as several text nodes inside one source span", () => {
    const span = root.querySelector("pre code > span[data-s]");
    expect(span?.querySelectorAll("span").length).toBeGreaterThan(3);
  });

  it("does not render frontmatter", () => {
    expect(root.textContent).not.toContain("status: review");
  });

  it("snaps an element-boundary selection (triple click) to the paragraph text", () => {
    const paragraph = Array.from(root.querySelectorAll("p")).find((element) => element.textContent?.startsWith("Tom"));
    if (!paragraph?.nextSibling) throw new Error("fixture paragraph missing");
    const range = doc.createRange();
    range.setStart(paragraph, 0);
    range.setEnd(paragraph.nextSibling, 0);
    const mapped = domRangeToSource(root, source, range);
    expect(source.slice(mapped?.start, mapped?.end)).toBe("Tom &amp; Jerry use \\*literal stars\\* and a pipe.");
  });

  it("tightens a start that sits at the end of the previous text node", () => {
    const range = selectRendered("early");
    const previous = root.querySelector("p span[data-s]")?.firstChild;
    if (previous?.nodeType !== 3) throw new Error("fixture text missing");
    range.setStart(previous, (previous as Text).data.length);
    const mapped = domRangeToSource(root, source, range);
    expect(source.slice(mapped?.start, mapped?.end)).toBe("early");
  });

  it("highlights a stored source anchor", () => {
    const start = source.indexOf("early, without a gate");
    const range = sourceToDomRange(root, source, start, start + "early, without a gate".length);
    expect(range?.toString()).toBe("early, without a gate");
  });

  it("degrades a source range starting inside markup to the nearest text", () => {
    const start = source.indexOf("[the docs]");
    const range = sourceToDomRange(root, source, start, start + "[the docs](".length);
    expect(range?.toString()).toBe("the docs");
  });
});

describe("align", () => {
  it("maps astral numeric entities to both UTF-16 units", () => {
    const alignment = align("a😀b", "a&#x1F600;b");
    expect(alignment.starts).toEqual([0, 1, 1, 10]);
    expect(alignment.ends).toEqual([1, 10, 10, 11]);
  });
});
