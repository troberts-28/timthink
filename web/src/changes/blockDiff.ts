import { diffArrays, diffWordsWithSpace } from "diff";
import type { Root, RootContent } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface SourceBlock {
  start: number;
  end: number;
  text: string;
  type: string;
  rendered: boolean;
}

export interface SourceSpan {
  start: number;
  end: number;
}

export interface Deletion {
  at: number;
  text: string;
}

export type BlockChange =
  | { kind: "changed"; start: number; end: number; insertions: SourceSpan[]; deletions: Deletion[] }
  | { kind: "added"; start: number; end: number };

export interface RemovedBlock {
  id: string;
  before: number | null;
  text: string;
  type: string;
}

export interface DocDiff {
  changes: BlockChange[];
  removed: RemovedBlock[];
  metadataChanged: boolean;
  blockCount: number;
}

const PAIRING_SIMILARITY = 0.35;
const FRONTMATTER_TYPES = new Set(["yaml", "toml"]);
const MEANINGFUL = /[\p{L}\p{N}]/u;

const parser = unified().use(remarkParse).use(remarkFrontmatter, ["yaml", "toml"]).use(remarkGfm);

function isLeadingTitle(node: RootContent, index: number, children: readonly RootContent[]): boolean {
  if (node.type !== "heading" || node.depth !== 1) return false;
  return children.slice(0, index).every((previous) => FRONTMATTER_TYPES.has(previous.type));
}

export function sourceBlocks(raw: string): SourceBlock[] {
  const tree = parser.parse(raw) as Root;
  return tree.children.flatMap((node, index, children) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return [];
    const rendered = !FRONTMATTER_TYPES.has(node.type) && !isLeadingTitle(node, index, children);
    return [{ start, end, text: raw.slice(start, end), type: node.type, rendered }];
  });
}

export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const common = diffWordsWithSpace(a, b)
    .filter((part) => !part.added && !part.removed)
    .reduce((total, part) => total + part.value.length, 0);
  return (2 * common) / (a.length + b.length);
}

export type WordSegment = { kind: "same"; text: string } | { kind: "change"; removed: string; added: string };

const SMALL_GAP = /^\s*\S{0,3}\s*$/;

export function wordSegments(before: string, after: string): WordSegment[] {
  const segments: WordSegment[] = [];
  for (const part of diffWordsWithSpace(before, after)) {
    const last = segments.at(-1);
    if (!part.added && !part.removed) segments.push({ kind: "same", text: part.value });
    else if (last?.kind === "change") {
      if (part.added) last.added += part.value;
      else last.removed += part.value;
    } else {
      segments.push({ kind: "change", removed: part.removed ? part.value : "", added: part.added ? part.value : "" });
    }
  }
  return absorbSmallGaps(segments);
}

function absorbSmallGaps(segments: WordSegment[]): WordSegment[] {
  const merged: WordSegment[] = [];
  for (const segment of segments) {
    const gap = merged.at(-1);
    const previous = merged.at(-2);
    if (segment.kind === "change" && gap?.kind === "same" && previous?.kind === "change" && SMALL_GAP.test(gap.text)) {
      merged.splice(-2, 2, {
        kind: "change",
        removed: previous.removed + gap.text + segment.removed,
        added: previous.added + gap.text + segment.added,
      });
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

function trimmedSpan(text: string, offset: number): SourceSpan {
  const leading = text.length - text.trimStart().length;
  const trailing = text.length - text.trimEnd().length;
  return { start: offset + leading, end: offset + text.length - trailing };
}

function wordChanges(before: SourceBlock, after: SourceBlock): Extract<BlockChange, { kind: "changed" }> {
  const insertions: SourceSpan[] = [];
  const deletions: Deletion[] = [];
  let offset = after.start;
  for (const segment of wordSegments(before.text, after.text)) {
    if (segment.kind === "same") {
      offset += segment.text.length;
      continue;
    }
    if (MEANINGFUL.test(segment.removed)) deletions.push({ at: offset, text: segment.removed });
    if (MEANINGFUL.test(segment.added)) insertions.push(trimmedSpan(segment.added, offset));
    offset += segment.added.length;
  }
  return { kind: "changed", start: after.start, end: after.end, insertions, deletions };
}

const MARKUP_EDGES = /^[\s|>#*+-]+|[\s|>#*+-]+$/g;

export function deletionLabel(text: string): string {
  return text.replace(MARKUP_EDGES, "").replace(/\s+/g, " ");
}

interface Pair {
  removed: number;
  added: number;
}

function pairBlocks(removed: readonly SourceBlock[], added: readonly SourceBlock[]): Pair[] {
  const pairs: Pair[] = [];
  let nextRemoved = 0;
  added.forEach((block, addedIndex) => {
    let best: { index: number; score: number } | null = null;
    for (let index = nextRemoved; index < removed.length; index += 1) {
      const candidate = removed[index];
      if (!candidate || candidate.type !== block.type) continue;
      const score = similarity(candidate.text, block.text);
      if (score >= PAIRING_SIMILARITY && (!best || score > best.score)) best = { index, score };
    }
    if (best) {
      pairs.push({ removed: best.index, added: addedIndex });
      nextRemoved = best.index + 1;
    }
  });
  return pairs;
}

interface Hunk {
  removed: SourceBlock[];
  added: SourceBlock[];
}

function resolveHunk(hunk: Hunk, nextStart: number | null, diff: DocDiff): void {
  const pairs = pairBlocks(hunk.removed, hunk.added);
  const pairedAdded = new Map(pairs.map((pair) => [pair.added, pair.removed]));
  const pairedRemoved = new Set(pairs.map((pair) => pair.removed));
  hunk.added.forEach((block, index) => {
    const partner = pairedAdded.get(index);
    const before = partner === undefined ? undefined : hunk.removed[partner];
    if (!block.rendered || before?.rendered === false) {
      diff.metadataChanged = true;
      return;
    }
    diff.changes.push(before ? wordChanges(before, block) : { kind: "added", start: block.start, end: block.end });
  });
  hunk.removed.forEach((block, index) => {
    if (pairedRemoved.has(index)) return;
    if (!block.rendered) {
      diff.metadataChanged = true;
      return;
    }
    const lastAddedBefore = Math.max(-1, ...pairs.filter((pair) => pair.removed < index).map((pair) => pair.added));
    const anchor = hunk.added[lastAddedBefore + 1];
    diff.removed.push({
      id: `removed-${block.start}`,
      before: anchor ? anchor.start : nextStart,
      text: block.text,
      type: block.type,
    });
  });
}

export function diffDocuments(before: string, after: string): DocDiff {
  const oldBlocks = sourceBlocks(before);
  const newBlocks = sourceBlocks(after);
  const diff: DocDiff = { changes: [], removed: [], metadataChanged: false, blockCount: 0 };
  const parts = diffArrays(oldBlocks, newBlocks, { comparator: (a, b) => a.text === b.text });
  let hunk: Hunk = { removed: [], added: [] };
  let newIndex = 0;
  const flush = () => {
    if (hunk.removed.length > 0 || hunk.added.length > 0) resolveHunk(hunk, newBlocks[newIndex]?.start ?? null, diff);
    hunk = { removed: [], added: [] };
  };
  for (const part of parts) {
    if (part.removed) hunk.removed.push(...part.value);
    else if (part.added) {
      hunk.added.push(...part.value);
      newIndex += part.value.length;
    } else {
      flush();
      newIndex += part.value.length;
    }
  }
  flush();
  diff.changes.sort((a, b) => a.start - b.start);
  diff.blockCount = diff.changes.length + diff.removed.length;
  return diff;
}
