import { detailsSectionKind, parseQuestionBlock } from "@timthink/server/shared";
import type { Element, ElementContent, Root } from "hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { Node } from "unist";
import { SKIP, visit } from "unist-util-visit";
import type { VFile } from "vfile";
import { fenceContentRange, rehypeUnwrapFences } from "./rehypePlugins";
import { type AutoLinkOptions, remarkAutoLinks } from "./remarkAutoLinks";
import { remarkCallouts, remarkFences } from "./remarkBlocks";

export interface DetailsSourceBase {
  offset: number;
  line: number;
}

const HEADING_DEPTH: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

function headingDepth(node: ElementContent): number | null {
  return node.type === "element" ? (HEADING_DEPTH[node.tagName] ?? null) : null;
}

function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

function section(heading: ElementContent): Element {
  return {
    type: "element",
    tagName: "section",
    properties: { dataQuestionSection: detailsSectionKind(textOf(heading)) ?? "other" },
    children: [],
  };
}

function sectionize(children: ElementContent[]): ElementContent[] {
  const depths = children.map(headingDepth).filter((depth): depth is number => depth !== null);
  if (depths.length === 0) return children;
  const sectionDepth = Math.min(...depths);
  const leading: ElementContent[] = [];
  const sections: Element[] = [];
  for (const child of children) {
    if (headingDepth(child) === sectionDepth) sections.push(section(child));
    (sections.at(-1)?.children ?? leading).push(child);
  }
  return [...leading, ...sections];
}

function relocate(tree: Root, base: DetailsSourceBase | null): void {
  visit(tree as Node, (node) => {
    if (!node.position) return;
    if (!base) {
      delete node.position;
      return;
    }
    const { start, end } = node.position;
    node.position = {
      start: { ...start, line: start.line + base.line - 1, offset: (start.offset ?? 0) + base.offset },
      end: { ...end, line: end.line + base.line - 1, offset: (end.offset ?? 0) + base.offset },
    };
  });
}

export function questionDetailsHast(
  markdown: string,
  options: AutoLinkOptions,
  base: DetailsSourceBase | null,
): Element {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFences)
    .use(remarkCallouts)
    .use(remarkAutoLinks, options)
    .use(remarkRehype)
    .use(rehypeUnwrapFences);
  const tree = processor.runSync(processor.parse(markdown), markdown);
  relocate(tree, base);
  const children = tree.children.filter((child): child is ElementContent => child.type !== "doctype");
  return {
    type: "element",
    tagName: "div",
    properties: { dataQuestionDetails: "" },
    children: sectionize(children),
  };
}

export function isQuestionDetails(node: Element): boolean {
  return node.properties.dataQuestionDetails !== undefined;
}

function fenceText(node: Element): string {
  return node.children.map((child) => (child.type === "text" ? child.value : "")).join("");
}

function verbatimBase(
  source: string,
  fence: Element,
  code: string,
  details: { offset: number; lineIndex: number },
): DetailsSourceBase | null {
  const start = fence.position?.start.offset;
  const end = fence.position?.end.offset;
  const fenceLine = fence.position?.start.line;
  if (start === undefined || end === undefined || fenceLine === undefined) return null;
  const [contentStart] = fenceContentRange(source, start, end);
  if (source.slice(contentStart, contentStart + code.length) !== code) return null;
  return { offset: contentStart + details.offset, line: fenceLine + 1 + details.lineIndex };
}

export function rehypeQuestionDetails(options: AutoLinkOptions) {
  return (tree: Root, file: VFile): void => {
    const source = String(file);
    visit(tree, "element", (node) => {
      if (node.properties.dataFence !== "question") return;
      const code = fenceText(node);
      const details = parseQuestionBlock(code, {}).details;
      if (!details) return SKIP;
      const base = verbatimBase(source, node, code, details);
      node.children.push(questionDetailsHast(details.markdown, options, base));
      if (base) {
        node.properties = {
          ...node.properties,
          dataDetailsStart: base.offset,
          dataDetailsEnd: base.offset + details.markdown.length,
        };
      }
      return SKIP;
    });
  };
}
