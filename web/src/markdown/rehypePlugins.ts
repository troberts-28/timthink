import GithubSlugger from "github-slugger";
import type { Element, ElementContent, Root, Text } from "hast";
import { SKIP, visit } from "unist-util-visit";
import type { VFile } from "vfile";

export interface TocEntry {
  id: string;
  text: string;
  depth: number;
}

const HEADING_DEPTH: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

function textContent(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textContent).join("");
  return "";
}

export function rehypeHeadingIds(toc: TocEntry[]) {
  return (tree: Root): void => {
    const slugger = new GithubSlugger();
    visit(tree, "element", (node) => {
      const depth = HEADING_DEPTH[node.tagName];
      if (!depth) return;
      const text = node.children.map(textContent).join("").trim();
      const id = slugger.slug(text || "section");
      node.properties = { ...node.properties, id };
      toc.push({ id, text, depth });
    });
  };
}

const POSITIONED_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ul",
  "ol",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "pre",
  "div",
  "hr",
  "a",
  "code",
  "strong",
  "em",
  "del",
  "img",
]);

function isFence(node: Element): boolean {
  return node.properties.dataFence !== undefined;
}

type SourceRange = readonly [number, number];

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

export function fenceContentRange(source: string, start: number, end: number): SourceRange {
  const block = source.slice(start, end);
  if (!FENCE_LINE.test(block)) return [start, end];
  const firstNewline = block.indexOf("\n");
  if (firstNewline === -1) return [end, end];
  const lastNewline = block.lastIndexOf("\n");
  const closed = lastNewline > firstNewline && FENCE_LINE.test(block.slice(lastNewline + 1).trimStart());
  return [start + firstNewline + 1, closed ? start + lastNewline + 1 : end];
}

function positionOf(node: Element | Text): SourceRange | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? null : [start, end];
}

function textRange(text: Text, parent: Element): SourceRange | null {
  return positionOf(text) ?? (parent.tagName === "code" ? positionOf(parent) : null);
}

function wrapText(text: Text, parent: Element, wrappers: WeakSet<Element>): Element | null {
  const range = textRange(text, parent);
  if (!range || !text.value.trim()) return null;
  const wrapper: Element = {
    type: "element",
    tagName: "span",
    properties: { dataS: range[0], dataE: range[1] },
    children: [text],
    position: text.position,
  };
  wrappers.add(wrapper);
  return wrapper;
}

export function rehypeSourcePositions() {
  return (tree: Root, file: VFile): void => {
    const source = String(file);
    const wrappers = new WeakSet<Element>();
    visit(tree, "element", (node) => {
      if (wrappers.has(node)) return SKIP;
      const range = positionOf(node);
      if (POSITIONED_TAGS.has(node.tagName) && range) {
        node.properties = { ...node.properties, dataS: range[0], dataE: range[1] };
      }
      if (isFence(node)) {
        if (range) {
          const [contentStart, contentEnd] = fenceContentRange(source, range[0], range[1]);
          node.properties = { ...node.properties, dataCs: contentStart, dataCe: contentEnd };
        }
        return SKIP;
      }
      node.children = node.children.map((child) =>
        child.type === "text" ? (wrapText(child, node, wrappers) ?? child) : child,
      );
      return;
    });
  };
}

function trimmedEnd(source: string, start: number, end: number): number {
  let trimmed = end;
  while (trimmed > start && /\s/.test(source[trimmed - 1] ?? "")) trimmed -= 1;
  return trimmed;
}

export function rehypeSectionRanges() {
  return (tree: Root, file: VFile): void => {
    const source = String(file);
    const headings = tree.children.filter(
      (child): child is Element => child.type === "element" && HEADING_DEPTH[child.tagName] !== undefined,
    );
    headings.forEach((heading, index) => {
      const depth = HEADING_DEPTH[heading.tagName] ?? 1;
      const start = heading.position?.start.offset;
      if (start === undefined) return;
      const next = headings.slice(index + 1).find((candidate) => (HEADING_DEPTH[candidate.tagName] ?? 1) <= depth);
      const end = next?.position?.start.offset ?? source.length;
      heading.properties = { ...heading.properties, dataSectionEnd: trimmedEnd(source, start, end) };
    });
  };
}

export function rehypeUnwrapFences() {
  return (tree: Root): void => {
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "pre" || !parent || index === undefined) return;
      const [only, ...rest] = node.children;
      if (rest.length > 0 || only?.type !== "element" || !isFence(only)) return;
      only.position = node.position;
      parent.children[index] = only;
      return SKIP;
    });
  };
}
