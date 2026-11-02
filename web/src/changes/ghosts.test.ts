import type { Element as HastElement } from "hast";
import { toHtml } from "hast-util-to-html";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { markdownToHast } from "../markdown/pipeline";
import { domRangeToSource, sourceToDomRange } from "../review/selectionMap";
import { diffDocuments } from "./blockDiff";
import { blockElements } from "./blockGeometry";
import { GHOST_TAG, withRemovedGhosts } from "./ghosts";

const options = { github: null, prLinks: "graphite" as const, docPath: "repo/plan.md", repoDocPaths: [] };

const BEFORE = `# Plan

## Context

The feed reads from the **activity** table.

This paragraph is going away entirely, it said nothing useful.

- First item
- Second item

Closing words about the rollout.
`;
const AFTER = BEFORE.replace("This paragraph is going away entirely, it said nothing useful.\n\n", "");

function render(raw: string, withGhosts: boolean): Element {
  const { hast } = markdownToHast(raw, options);
  const diff = diffDocuments(BEFORE, raw);
  const tree = withGhosts ? withRemovedGhosts(hast, diff.removed) : hast;
  for (const child of tree.children) {
    if (child.type === "element" && child.tagName === GHOST_TAG) {
      (child as HastElement).children = [{ type: "text", value: "Removed: This paragraph is going away entirely" }];
    }
  }
  const main = new JSDOM(`<main>${toHtml(tree)}</main>`).window.document.querySelector("main");
  if (!main) throw new Error("no main");
  return main;
}

function rangeOver(root: Element, text: string): Range {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const index = node.nodeValue?.indexOf(text) ?? -1;
    if (index >= 0) {
      const range = doc.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);
      return range;
    }
  }
  throw new Error(`text not found: ${text}`);
}

describe("removed-block ghosts", () => {
  it("are inserted in place, before the block that now follows the removed one", () => {
    const root = render(AFTER, true);
    const ghost = root.querySelector(GHOST_TAG);
    expect(ghost?.previousElementSibling?.textContent).toBe("The feed reads from the activity table.");
    expect(ghost?.nextElementSibling?.tagName).toBe("UL");
  });

  it("leave selection-to-source mapping unchanged", () => {
    const plain = render(AFTER, false);
    const ghosted = render(AFTER, true);
    for (const text of ["Second item", "Closing words", "activity"]) {
      const expected = domRangeToSource(plain, AFTER, rangeOver(plain, text));
      expect(domRangeToSource(ghosted, AFTER, rangeOver(ghosted, text))).toEqual(expected);
      expect(AFTER.slice(expected?.start, expected?.end)).toContain(text);
    }
    const across = ghosted.ownerDocument.createRange();
    across.setStart(rangeOver(ghosted, "table").startContainer, rangeOver(ghosted, "table").startOffset);
    across.setEnd(rangeOver(ghosted, "First").endContainer, rangeOver(ghosted, "First").endOffset);
    const mapped = domRangeToSource(ghosted, AFTER, across);
    expect(AFTER.slice(mapped?.start, mapped?.end)).toBe("table.\n\n- First");
  });

  it("leave source-to-DOM ranges (used for review highlights) unchanged", () => {
    const ghosted = render(AFTER, true);
    const start = AFTER.indexOf("Closing words");
    expect(sourceToDomRange(ghosted, AFTER, start, start + "Closing words".length)?.toString()).toBe("Closing words");
  });
});

describe("blockElements", () => {
  it("finds the outermost rendered elements for a source block", () => {
    const root = render(AFTER, false);
    const start = AFTER.indexOf("- First");
    const end = AFTER.indexOf("\n\nClosing");
    expect(blockElements(root, start, end).map((element) => element.tagName)).toEqual(["UL"]);
  });
});
