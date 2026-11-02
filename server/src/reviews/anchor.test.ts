import { describe, expect, it } from "vitest";
import { createAnchor, InvalidRangeError, locateAnchor } from "./anchor.js";
import { fuzzySearch } from "./fuzzy.js";
import { docHash } from "./paths.js";
import { reanchorThreads } from "./reanchor.js";
import type { Anchor, ReviewFile, Thread } from "./schema.js";
import { findSection, headingPathAt, lineNumberAt } from "./sections.js";

const PLAN = `---
title: Activity feed
# not a heading
---

# Activity feed

## TL;DR

Start writing to it **early, without a gate**, so history has depth from day one.

## Rollout

\`\`\`sh
# not a heading either
\`\`\`

### Phase one

Ship the table first. Then backfill the last thirty days of activity from the audit log.

## Risks

Writes could be slow. Start writing to it early, without a gate, only after load tests.
`;

function anchorFor(source: string, quote: string, occurrence = 0): Anchor {
  let start = -1;
  for (let seen = 0; seen <= occurrence; seen += 1) start = source.indexOf(quote, start + 1);
  if (start === -1) throw new Error(`quote not found: ${quote}`);
  return createAnchor(source, start, start + quote.length, docHash(source));
}

function quoteAt(source: string, anchor: Anchor): string | null {
  const match = locateAnchor(source, anchor);
  return match ? source.slice(match.start, match.end) : null;
}

describe("sections", () => {
  it("builds heading paths, ignoring frontmatter and fenced code", () => {
    expect(headingPathAt(PLAN, PLAN.indexOf("Ship the table"))).toEqual(["Activity feed", "Rollout", "Phase one"]);
    expect(headingPathAt(PLAN, PLAN.indexOf("early, without"))).toEqual(["Activity feed", "TL;DR"]);
    expect(headingPathAt(PLAN, 5)).toEqual([]);
  });

  it("finds a section's range up to the next heading at the same depth", () => {
    const section = findSection(PLAN, ["Activity feed", "Rollout"]);
    expect(PLAN.slice(section?.start, section?.end)).toMatch(/^## Rollout[\s\S]*audit log\.\n\n$/);
    expect(findSection(PLAN, ["Activity feed", "Gone"])).toBeNull();
  });

  it("counts lines", () => {
    expect(lineNumberAt(PLAN, 0)).toBe(1);
    expect(lineNumberAt(PLAN, PLAN.indexOf("# Activity feed"))).toBe(6);
  });
});

describe("createAnchor", () => {
  it("captures quote, context, heading path and hash", () => {
    const anchor = anchorFor(PLAN, "early, without a gate");
    expect(anchor.quote).toBe("early, without a gate");
    expect(anchor.prefix.endsWith("Start writing to it **")).toBe(true);
    expect(anchor.suffix.startsWith("**, so history")).toBe(true);
    expect(anchor.headingPath).toEqual(["Activity feed", "TL;DR"]);
    expect(anchor.docHash).toBe(docHash(PLAN));
  });

  it("rejects empty, out-of-range and frontmatter ranges", () => {
    expect(() => createAnchor(PLAN, 10, 10, "h")).toThrow(InvalidRangeError);
    expect(() => createAnchor(PLAN, 0, PLAN.length + 1, "h")).toThrow(InvalidRangeError);
    expect(() => createAnchor(PLAN, 4, 9, "h")).toThrow(/frontmatter/);
  });
});

describe("locateAnchor", () => {
  it("keeps exact offsets when the quote is still there", () => {
    const anchor = anchorFor(PLAN, "Ship the table first.");
    expect(locateAnchor(PLAN, anchor)).toEqual({ method: "exact", start: anchor.start, end: anchor.end });
  });

  it("follows a paragraph that moved", () => {
    const anchor = anchorFor(PLAN, "Ship the table first.");
    const moved = PLAN.replace("## TL;DR\n", "## TL;DR\n\nA brand new opening paragraph pushes everything down.\n");
    const match = locateAnchor(moved, anchor);
    expect(match?.method).toBe("quote");
    expect(moved.slice(match?.start, match?.end)).toBe("Ship the table first.");
  });

  it("picks the duplicate whose prefix and suffix match", () => {
    const second = anchorFor(PLAN, "early, without a gate", 1);
    const shifted = `Intro line.\n${PLAN}`;
    const match = locateAnchor(shifted, second);
    expect(match?.method).toBe("quote");
    expect(match?.start).toBe(second.start + "Intro line.\n".length);
    const first = anchorFor(PLAN, "early, without a gate", 0);
    expect(locateAnchor(shifted, first)?.start).toBe(first.start + "Intro line.\n".length);
  });

  it("re-finds a lightly rewritten sentence inside its section", () => {
    const anchor = anchorFor(PLAN, "Then backfill the last thirty days of activity from the audit log.");
    const rewritten = PLAN.replace(
      "Then backfill the last thirty days of activity from the audit log.",
      "Then backfill the last 30 days of activity from the audit log.",
    );
    const match = locateAnchor(rewritten, anchor);
    expect(match?.method).toBe("fuzzy");
    expect(rewritten.slice(match?.start, match?.end)).toBe(
      "Then backfill the last 30 days of activity from the audit log.",
    );
  });

  it("re-finds a long quote whose middle was rewritten", () => {
    const long = `${"The scheduler wakes every minute and checks pending jobs. ".repeat(6)}It then reports.`;
    const source = `# Plan\n\n## Jobs\n\n${long}\n\n## Other\n\nUnrelated.\n`;
    const anchor = anchorFor(source, long);
    const edited = source.replace(
      "checks pending jobs. The scheduler wakes",
      "checks queued work. The scheduler wakes",
    );
    const match = locateAnchor(edited, anchor);
    expect(match?.method).toBe("fuzzy");
    expect(edited.slice(match?.start, match?.end).endsWith("It then reports.")).toBe(true);
  });

  it("reports deleted text as outdated", () => {
    const anchor = anchorFor(PLAN, "Writes could be slow.");
    expect(quoteAt(PLAN.replace("Writes could be slow. ", ""), anchor)).toBeNull();
  });

  it("does not fuzzy-match very short quotes", () => {
    const anchor = anchorFor(PLAN, "table");
    expect(quoteAt(PLAN.replace("table", "tablet"), anchor)).toBe("table");
    expect(quoteAt(PLAN.replace("table", "tabel"), anchor)).toBeNull();
  });

  it("stays fast on a 100KB document", () => {
    const filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(1800);
    const quote = "a uniquely phrased sentence that will be lightly edited later on";
    const source = `# Big\n\n${filler}${quote}${filler}`;
    const anchor = anchorFor(source, quote);
    const edited = source.replace("lightly edited", "slightly edited");
    const started = performance.now();
    const match = locateAnchor(edited, anchor);
    expect(performance.now() - started).toBeLessThan(500);
    expect(edited.slice(match?.start, match?.end)).toContain("slightly edited later on");
  });
});

describe("fuzzySearch", () => {
  it("returns start and end of approximate matches", () => {
    const [best] = fuzzySearch("xx the quick brwn fox xx", "quick brown", 1);
    expect(best).toMatchObject({ errors: 1 });
    expect("xx the quick brwn fox xx".slice(best?.start, best?.end)).toBe("quick brwn");
  });
});

function threadWith(anchor: Anchor, status: Thread["status"] = "open"): Thread {
  return {
    id: "t-1",
    reviewId: "r-1",
    kind: "comment",
    anchor,
    suggestion: null,
    status,
    createdAt: "",
    resolvedAt: null,
    resolvedBy: null,
    messages: [],
  };
}

function fileWith(threads: Thread[]): ReviewFile {
  return { schemaVersion: 1, doc: "repo/plan.md", version: 1, reviews: [], threads, answers: [] };
}

describe("reanchorThreads", () => {
  it("refreshes anchors, marks lost ones outdated and revives them when the text returns", () => {
    const anchor = anchorFor(PLAN, "Writes could be slow.");
    const without = PLAN.replace("Writes could be slow. ", "");
    const outdated = reanchorThreads(fileWith([threadWith(anchor)]), without, docHash(without));
    expect(outdated.threads[0]?.status).toBe("outdated");
    expect(outdated.threads[0]?.anchor.quote).toBe("Writes could be slow.");

    const restored = `${PLAN}\n`;
    const revived = reanchorThreads(outdated, restored, docHash(restored));
    expect(revived.threads[0]?.status).toBe("open");
    expect(revived.threads[0]?.anchor.docHash).toBe(docHash(restored));
  });

  it("keeps resolved threads resolved and skips work when hashes match", () => {
    const anchor = anchorFor(PLAN, "Writes could be slow.");
    const file = fileWith([threadWith(anchor, "resolved")]);
    expect(reanchorThreads(file, PLAN, docHash(PLAN))).toBe(file);
    const without = PLAN.replace("Writes could be slow. ", "");
    expect(reanchorThreads(file, without, docHash(without)).threads[0]?.status).toBe("resolved");
  });
});
