import { diffLines } from "diff";
import { wordSegments } from "./blockDiff";

export type WordPart = { text: string; changed: boolean };

export type RawDiffChunk =
  | { kind: "same"; lines: string[] }
  | { kind: "change"; removed: WordPart[]; added: WordPart[] };

const CONTEXT_LINES = 3;

function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function wordParts(before: string, after: string): { removed: WordPart[]; added: WordPart[] } {
  if (!before || !after) {
    return {
      removed: before ? [{ text: before, changed: false }] : [],
      added: after ? [{ text: after, changed: false }] : [],
    };
  }
  const removed: WordPart[] = [];
  const added: WordPart[] = [];
  for (const segment of wordSegments(before, after)) {
    if (segment.kind === "same") {
      removed.push({ text: segment.text, changed: false });
      added.push({ text: segment.text, changed: false });
      continue;
    }
    if (segment.removed) removed.push({ text: segment.removed, changed: true });
    if (segment.added) added.push({ text: segment.added, changed: true });
  }
  return { removed, added };
}

export function rawDiff(before: string, after: string): RawDiffChunk[] {
  const chunks: RawDiffChunk[] = [];
  let pending: { removed: string; added: string } | null = null;
  const flush = () => {
    if (pending) {
      chunks.push({
        kind: "change",
        ...wordParts(pending.removed.replace(/\n$/, ""), pending.added.replace(/\n$/, "")),
      });
    }
    pending = null;
  };
  for (const part of diffLines(before, after)) {
    if (part.added || part.removed) {
      pending ??= { removed: "", added: "" };
      if (part.added) pending.added += part.value;
      else pending.removed += part.value;
    } else {
      flush();
      chunks.push({ kind: "same", lines: splitLines(part.value) });
    }
  }
  flush();
  return chunks;
}

export type CollapsedChunk = RawDiffChunk | { kind: "skip"; count: number };

export function collapseContext(chunks: readonly RawDiffChunk[]): CollapsedChunk[] {
  return chunks.flatMap((chunk, index): CollapsedChunk[] => {
    if (chunk.kind !== "same") return [chunk];
    const keepBefore = index > 0 ? CONTEXT_LINES : 0;
    const keepAfter = index < chunks.length - 1 ? CONTEXT_LINES : 0;
    if (chunk.lines.length <= keepBefore + keepAfter + 1) return [chunk];
    const head = chunk.lines.slice(0, keepBefore);
    const tail = keepAfter > 0 ? chunk.lines.slice(-keepAfter) : [];
    const skipped = chunk.lines.length - head.length - tail.length;
    return [
      ...(head.length > 0 ? [{ kind: "same" as const, lines: head }] : []),
      { kind: "skip" as const, count: skipped },
      ...(tail.length > 0 ? [{ kind: "same" as const, lines: tail }] : []),
    ];
  });
}
