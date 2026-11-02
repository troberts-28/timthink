import type { Element, ElementContent, Root, RootContent } from "hast";

export interface SourceSpan {
  start: number;
  end: number;
}

function findElement(nodes: readonly (Root | RootContent)[], tagName: string): Element | null {
  for (const node of nodes) {
    if (node.type === "element" && node.tagName === tagName) return node;
    if (node.type === "element" || node.type === "root") {
      const nested = findElement(node.children, tagName);
      if (nested) return nested;
    }
  }
  return null;
}

function sourceWrapped(children: ElementContent[], span: SourceSpan | null): ElementContent[] {
  if (!span) return children;
  return [{ type: "element", tagName: "span", properties: { dataS: span.start, dataE: span.end }, children }];
}

export function codeBlockHast(highlighted: Root | null, code: string, span: SourceSpan | null): Root {
  const pre = highlighted ? findElement([highlighted], "pre") : null;
  const codeElement = pre ? findElement(pre.children, "code") : null;
  if (pre && codeElement) {
    const wrappedCode: Element = { ...codeElement, children: sourceWrapped(codeElement.children, span) };
    const children = pre.children.map((child) => (child === codeElement ? wrappedCode : child));
    return { type: "root", children: [{ ...pre, children }] };
  }
  const plainCode: Element = {
    type: "element",
    tagName: "code",
    properties: {},
    children: sourceWrapped([{ type: "text", value: code }], span),
  };
  return { type: "root", children: [{ type: "element", tagName: "pre", properties: {}, children: [plainCode] }] };
}
