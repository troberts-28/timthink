import { describe, expect, it } from "vitest";
import { deletionLabel, diffDocuments, sourceBlocks } from "./blockDiff";
import { collapseContext, rawDiff } from "./rawDiff";

const BEFORE = `---
title: Feed
status: draft
---
# Feed

## Plan

Write to the activity table early, without a gate, so history builds up.

- Add the table
- Backfill old rows
- Ship the reader

| Step | Owner |
| --- | --- |
| Schema | Sam |
| Reader | Sam |
`;

function slice(raw: string, span: { start: number; end: number }): string {
  return raw.slice(span.start, span.end);
}

describe("sourceBlocks", () => {
  it("splits top-level blocks and marks frontmatter and the leading title as unrendered", () => {
    const blocks = sourceBlocks(BEFORE);
    expect(blocks.map((block) => [block.type, block.rendered])).toEqual([
      ["yaml", false],
      ["heading", false],
      ["heading", true],
      ["paragraph", true],
      ["list", true],
      ["table", true],
    ]);
  });
});

describe("diffDocuments", () => {
  it("finds nothing when the documents match", () => {
    expect(diffDocuments(BEFORE, BEFORE)).toEqual({ changes: [], removed: [], metadataChanged: false, blockCount: 0 });
  });

  it("maps a reworded paragraph to word-level insertions and deletions in the new source", () => {
    const after = BEFORE.replace("early, without a gate", "from day one behind a flag");
    const diff = diffDocuments(BEFORE, after);
    expect(diff.blockCount).toBe(1);
    const [change] = diff.changes;
    if (change?.kind !== "changed") throw new Error("expected a changed block");
    expect(slice(after, change)).toMatch(/^Write to the activity table from day one/);
    expect(change.insertions.map((span) => slice(after, span))).toEqual(["from day one behind a flag"]);
    expect(change.deletions.map((deletion) => deletion.text)).toEqual(["early, without a gate"]);
    expect(change.deletions[0]?.at).toBe(after.indexOf("from day one"));
  });

  it("reports added sections as added blocks and a deleted list item inside the list", () => {
    const after = BEFORE.replace("- Backfill old rows\n", "").replace(
      "| Step |",
      "## Rollout\n\nShip it to staff first.\n\n| Step |",
    );
    const diff = diffDocuments(BEFORE, after);
    expect(diff.changes.map((change) => [change.kind, slice(after, change).split("\n")[0]])).toEqual([
      ["changed", "- Add the table"],
      ["added", "## Rollout"],
      ["added", "Ship it to staff first."],
    ]);
    const list = diff.changes[0];
    if (list?.kind !== "changed") throw new Error("expected a changed list");
    expect(list.insertions).toEqual([]);
    expect(list.deletions.map((deletion) => deletionLabel(deletion.text))).toEqual(["Backfill old rows"]);
    expect(list.deletions[0]?.at).toBe(after.indexOf("Ship the reader"));
  });

  it("maps a changed table cell to an insertion inside the table", () => {
    const after = BEFORE.replace("| Reader | Sam |", "| Reader | Alex |");
    const [change] = diffDocuments(BEFORE, after).changes;
    if (change?.kind !== "changed") throw new Error("expected a changed table");
    expect(change.insertions.map((span) => slice(after, span))).toEqual(["Alex"]);
    expect(change.deletions.map((deletion) => deletion.text)).toEqual(["Sam"]);
  });

  it("shows a removed block as a ghost before the block that now follows it", () => {
    const after = BEFORE.replace("Write to the activity table early, without a gate, so history builds up.\n\n", "");
    const diff = diffDocuments(BEFORE, after);
    expect(diff.changes).toEqual([]);
    expect(diff.removed).toEqual([
      expect.objectContaining({ type: "paragraph", before: after.indexOf("- Add the table") }),
    ]);
    expect(diff.removed[0]?.text).toMatch(/^Write to the activity table/);
  });

  it("treats an unrelated rewrite as a removal plus an addition, and frontmatter edits as metadata", () => {
    const after = BEFORE.replace("status: draft", "status: review").replace(
      "Write to the activity table early, without a gate, so history builds up.",
      "Completely different words about caching layers.",
    );
    const diff = diffDocuments(BEFORE, after);
    expect(diff.metadataChanged).toBe(true);
    expect(diff.changes.map((change) => change.kind)).toEqual(["added"]);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]?.before).toBe(after.indexOf("Completely different"));
    expect(diff.blockCount).toBe(2);
  });

  it("puts a ghost for a removed final block at the end", () => {
    const after = BEFORE.slice(0, BEFORE.indexOf("| Step |"));
    expect(diffDocuments(BEFORE, after).removed).toEqual([expect.objectContaining({ type: "table", before: null })]);
  });
});

describe("rawDiff", () => {
  it("pairs changed lines with merged word-level changes and collapses unchanged context", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h", "Ship it early, without a gate.", "z"].join("\n");
    const after = before.replace("early, without a gate", "from day one behind a flag");
    const chunks = collapseContext(rawDiff(before, after));
    expect(chunks.map((chunk) => chunk.kind)).toEqual(["skip", "same", "change", "same"]);
    const change = chunks.find((chunk) => chunk.kind === "change");
    if (change?.kind !== "change") throw new Error("expected a change");
    expect(change.removed.filter((part) => part.changed).map((part) => part.text)).toEqual(["early, without a gate"]);
    expect(change.added.filter((part) => part.changed).map((part) => part.text)).toEqual([
      "from day one behind a flag",
    ]);
  });
});
