import type { Element, Root, RootContent } from "hast";
import type { RemovedBlock } from "./blockDiff";

export const GHOST_TAG = "aside";
export const GHOST_ATTRIBUTE = "data-diff-ghost";

function ghostElement(block: RemovedBlock): Element {
  return { type: "element", tagName: GHOST_TAG, properties: { dataDiffGhost: block.id }, children: [] };
}

function insertionIndex(children: readonly RootContent[], before: number | null): number {
  if (before === null) return children.length;
  const index = children.findIndex((child) => (child.position?.start.offset ?? -1) >= before);
  return index === -1 ? children.length : index;
}

export function withRemovedGhosts(tree: Root, removed: readonly RemovedBlock[]): Root {
  if (removed.length === 0) return tree;
  const ghostsAt = new Map<number, Element[]>();
  for (const block of removed) {
    const index = insertionIndex(tree.children, block.before);
    ghostsAt.set(index, [...(ghostsAt.get(index) ?? []), ghostElement(block)]);
  }
  const children: RootContent[] = [];
  tree.children.forEach((child, index) => {
    children.push(...(ghostsAt.get(index) ?? []), child);
  });
  children.push(...(ghostsAt.get(tree.children.length) ?? []));
  return { ...tree, children };
}
