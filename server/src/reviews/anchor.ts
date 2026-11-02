import { type FuzzyMatch, fuzzySearch } from "./fuzzy.js";
import type { Anchor } from "./schema.js";
import { findHeadings, findSection, frontmatterEnd, headingPathAt } from "./sections.js";

export const ANCHOR_CONTEXT_LENGTH = 32;
const FUZZY_TOLERANCE = 0.25;
const MIN_FUZZY_QUOTE_LENGTH = 8;
const LONG_QUOTE_LENGTH = 256;
const LONG_QUOTE_EDGE_LENGTH = 64;
const LONG_QUOTE_LENGTH_SLACK = 0.5;

export type AnchorMethod = "exact" | "quote" | "fuzzy";

export interface AnchorMatch {
  method: AnchorMethod;
  start: number;
  end: number;
}

export class InvalidRangeError extends Error {}

export function createAnchor(source: string, start: number, end: number, docHash: string): Anchor {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > source.length || end <= start) {
    throw new InvalidRangeError("The selected range is outside the document");
  }
  if (start < frontmatterEnd(source)) throw new InvalidRangeError("Comments can't be anchored in the frontmatter");
  return anchorAt(source, start, end, docHash);
}

function anchorAt(source: string, start: number, end: number, docHash: string): Anchor {
  return {
    quote: source.slice(start, end),
    prefix: source.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start),
    suffix: source.slice(end, end + ANCHOR_CONTEXT_LENGTH),
    headingPath: headingPathAt(source, start),
    start,
    end,
    docHash,
  };
}

export function refreshAnchor(source: string, match: AnchorMatch, docHash: string): Anchor {
  return anchorAt(source, match.start, match.end, docHash);
}

function commonSuffixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[a.length - 1 - length] === b[b.length - 1 - length]) length += 1;
  return length;
}

function commonPrefixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
}

function contextScore(source: string, anchor: Anchor, start: number, end: number): number {
  const before = source.slice(Math.max(0, start - anchor.prefix.length), start);
  const after = source.slice(end, end + anchor.suffix.length);
  return commonSuffixLength(before, anchor.prefix) + commonPrefixLength(after, anchor.suffix);
}

function occurrences(source: string, quote: string): number[] {
  const found: number[] = [];
  for (let at = source.indexOf(quote); at !== -1; at = source.indexOf(quote, at + 1)) found.push(at);
  return found;
}

function bestQuoteMatch(source: string, anchor: Anchor): AnchorMatch | null {
  const candidates = occurrences(source, anchor.quote);
  let best: { start: number; score: number; distance: number } | null = null;
  for (const start of candidates) {
    const score = contextScore(source, anchor, start, start + anchor.quote.length);
    const distance = Math.abs(start - anchor.start);
    if (!best || score > best.score || (score === best.score && distance < best.distance)) {
      best = { start, score, distance };
    }
  }
  return best ? { method: "quote", start: best.start, end: best.start + anchor.quote.length } : null;
}

interface Region {
  start: number;
  end: number;
}

function searchRegion(source: string, anchor: Anchor): Region {
  const section = findSection(source, anchor.headingPath);
  if (section) return { start: section.start, end: section.end };
  if (anchor.headingPath.length === 0) {
    const firstHeading = findHeadings(source)[0];
    return { start: frontmatterEnd(source), end: firstHeading?.start ?? source.length };
  }
  return { start: frontmatterEnd(source), end: source.length };
}

function closestBest(matches: readonly FuzzyMatch[], expectedStart: number): FuzzyMatch | null {
  let best: FuzzyMatch | null = null;
  for (const match of matches) {
    if (
      !best ||
      match.errors < best.errors ||
      (match.errors === best.errors && Math.abs(match.start - expectedStart) < Math.abs(best.start - expectedStart))
    ) {
      best = match;
    }
  }
  return best;
}

function fuzzyFind(source: string, pattern: string, region: Region, expectedStart: number): FuzzyMatch | null {
  const maxErrors = Math.floor(pattern.length * FUZZY_TOLERANCE);
  return closestBest(fuzzySearch(source, pattern, maxErrors, region.start, region.end), expectedStart);
}

function fuzzyLongQuote(source: string, anchor: Anchor, region: Region): AnchorMatch | null {
  const head = fuzzyFind(source, anchor.quote.slice(0, LONG_QUOTE_EDGE_LENGTH), region, anchor.start);
  if (!head) return null;
  const expectedTailStart = head.start + anchor.quote.length - LONG_QUOTE_EDGE_LENGTH;
  const tail = fuzzyFind(
    source,
    anchor.quote.slice(-LONG_QUOTE_EDGE_LENGTH),
    { start: head.end, end: region.end },
    expectedTailStart,
  );
  if (!tail) return null;
  const length = tail.end - head.start;
  const slack = anchor.quote.length * LONG_QUOTE_LENGTH_SLACK;
  if (Math.abs(length - anchor.quote.length) > slack) return null;
  return { method: "fuzzy", start: head.start, end: tail.end };
}

function fuzzyQuoteMatch(source: string, anchor: Anchor): AnchorMatch | null {
  if (anchor.quote.trim().length < MIN_FUZZY_QUOTE_LENGTH) return null;
  const region = searchRegion(source, anchor);
  if (anchor.quote.length > LONG_QUOTE_LENGTH) return fuzzyLongQuote(source, anchor, region);
  const match = fuzzyFind(source, anchor.quote, region, anchor.start);
  return match ? { method: "fuzzy", start: match.start, end: match.end } : null;
}

export function locateAnchor(source: string, anchor: Anchor): AnchorMatch | null {
  if (source.slice(anchor.start, anchor.end) === anchor.quote) {
    return { method: "exact", start: anchor.start, end: anchor.end };
  }
  return bestQuoteMatch(source, anchor) ?? fuzzyQuoteMatch(source, anchor);
}
