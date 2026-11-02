import type { Blockquote, Paragraph, PhrasingContent, Root } from "mdast";
import { visit } from "unist-util-visit";

export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution";

const CALLOUT_WORDS: Record<string, CalloutKind> = {
  note: "note",
  info: "note",
  tip: "tip",
  important: "important",
  warning: "warning",
  caution: "caution",
  danger: "caution",
};

const FRONTMATTER_TYPES = new Set<string>(["yaml", "toml"]);
const ALERT_MARKER = /^\[!(\w+)\]\s*/;

function plainText(node: PhrasingContent): string {
  if (node.type === "text") return node.value;
  if ("children" in node) return node.children.map(plainText).join("");
  return "";
}

function calloutFromStrong(paragraph: Paragraph): CalloutKind | null {
  const [first] = paragraph.children;
  if (first?.type !== "strong") return null;
  const word = plainText(first).replace(/[:.]$/, "").trim().toLowerCase();
  return CALLOUT_WORDS[word] ?? null;
}

function takeAlertMarker(paragraph: Paragraph): CalloutKind | null {
  const [first] = paragraph.children;
  if (first?.type !== "text") return null;
  const match = ALERT_MARKER.exec(first.value);
  const kind = match?.[1] ? CALLOUT_WORDS[match[1].toLowerCase()] : undefined;
  if (!match || !kind) return null;
  first.value = first.value.slice(match[0].length);
  return kind;
}

function calloutKind(node: Blockquote): CalloutKind | null {
  const [first] = node.children;
  if (first?.type !== "paragraph") return null;
  return takeAlertMarker(first) ?? calloutFromStrong(first);
}

export function remarkCallouts() {
  return (tree: Root): void => {
    visit(tree, "blockquote", (node) => {
      const kind = calloutKind(node);
      if (kind) node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataCallout: kind } };
    });
  };
}

export function remarkFences() {
  return (tree: Root): void => {
    visit(tree, "code", (node) => {
      node.data = {
        ...node.data,
        hName: "div",
        hProperties: { dataFence: node.lang?.toLowerCase() ?? "", dataMeta: node.meta ?? "" },
        hChildren: [{ type: "text", value: node.value }],
      };
    });
  };
}

export function remarkDropLeadingTitle() {
  return (tree: Root): void => {
    const index = tree.children.findIndex((node) => !FRONTMATTER_TYPES.has(node.type));
    const first = tree.children[index];
    if (first?.type === "heading" && first.depth === 1) tree.children.splice(index, 1);
  };
}
