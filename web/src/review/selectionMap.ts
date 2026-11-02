import { decodeNamedCharacterReference } from "decode-named-character-reference";

export interface SourceRange {
  start: number;
  end: number;
}

interface Alignment {
  starts: number[];
  ends: number[];
}

const TEXT_SPAN_SELECTOR = "span[data-s]";
const MARKUP_SELECTOR = ":is(strong, em, del, a, code)[data-s]";
const ENTITY = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([A-Za-z][A-Za-z\d]{0,31}));/y;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const SHOW_TEXT = 4;

function decodeEntityAt(source: string, at: number): { decoded: string; length: number } | null {
  ENTITY.lastIndex = at;
  const match = ENTITY.exec(source);
  if (!match) return null;
  let decoded: string | false = false;
  if (match[1]) decoded = String.fromCodePoint(Number(match[1]));
  else if (match[2]) decoded = String.fromCodePoint(Number.parseInt(match[2], 16));
  else if (match[3]) decoded = decodeNamedCharacterReference(match[3]);
  return decoded ? { decoded, length: match[0].length } : null;
}

// Greedy char-by-char alignment of rendered text to its markdown source: markup the renderer dropped
// (delimiters, escapes, entities, indentation) is skipped over, so each rendered UTF-16 unit gets a source span.
export function align(text: string, source: string, sourceBase = 0): Alignment {
  const starts: number[] = [];
  const ends: number[] = [];
  let cursor = 0;
  let index = 0;
  while (index < text.length) {
    let matched = 0;
    for (let scan = cursor; scan < source.length; scan += 1) {
      const entity = source[scan] === "&" ? decodeEntityAt(source, scan) : null;
      if (entity && text.startsWith(entity.decoded, index)) {
        for (let unit = 0; unit < entity.decoded.length; unit += 1) {
          starts.push(sourceBase + scan);
          ends.push(sourceBase + scan + entity.length);
        }
        matched = entity.decoded.length;
        cursor = scan + entity.length;
        break;
      }
      const char = text[index] ?? "";
      if (source[scan] === "\\" && source[scan + 1] === char && ASCII_PUNCTUATION.test(char)) {
        starts.push(sourceBase + scan);
        ends.push(sourceBase + scan + 2);
        matched = 1;
        cursor = scan + 2;
        break;
      }
      if (source[scan] === char) {
        starts.push(sourceBase + scan);
        ends.push(sourceBase + scan + 1);
        matched = 1;
        cursor = scan + 1;
        break;
      }
    }
    if (!matched) {
      starts.push(sourceBase + cursor);
      ends.push(sourceBase + cursor);
      matched = 1;
    }
    index += matched;
  }
  return { starts, ends };
}

const alignmentCache = new WeakMap<Element, { source: string; alignment: Alignment }>();

function spanBounds(span: Element): SourceRange {
  return { start: Number(span.getAttribute("data-s")), end: Number(span.getAttribute("data-e")) };
}

function alignmentOf(span: Element, source: string): Alignment {
  const cached = alignmentCache.get(span);
  if (cached?.source === source) return cached.alignment;
  const { start, end } = spanBounds(span);
  const alignment = align(span.textContent ?? "", source.slice(start, end), start);
  alignmentCache.set(span, { source, alignment });
  return alignment;
}

function textSpans(root: Element): Element[] {
  return Array.from(root.querySelectorAll(TEXT_SPAN_SELECTOR));
}

function comparePoints(doc: Document, aNode: Node, aOffset: number, bNode: Node, bOffset: number): number {
  const range = doc.createRange();
  range.setStart(aNode, aOffset);
  return -range.comparePoint(bNode, bOffset);
}

function charIndexInSpan(span: Element, node: Node, offset: number): number | null {
  if (node.nodeType !== TEXT_NODE) return null;
  const walker = span.ownerDocument.createTreeWalker(span, SHOW_TEXT);
  let index = 0;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (text === node) return index + offset;
    index += text.nodeValue?.length ?? 0;
  }
  return null;
}

function snap(root: Element, source: string, node: Node, offset: number, edge: "start" | "end"): number | null {
  const doc = root.ownerDocument;
  const spans = textSpans(root);
  if (edge === "start") {
    const next = spans.find((span) => comparePoints(doc, node, offset, span, 0) <= 0);
    return next ? (alignmentOf(next, source).starts[0] ?? spanBounds(next).start) : null;
  }
  const previous = spans.findLast((span) => comparePoints(doc, span, span.childNodes.length, node, offset) <= 0);
  return previous ? (alignmentOf(previous, source).ends.at(-1) ?? spanBounds(previous).end) : null;
}

function hostElement(node: Node): Element | null {
  if (node.nodeType === TEXT_NODE) return node.parentElement;
  return node.nodeType === ELEMENT_NODE ? (node as Element) : null;
}

export function domPointToSource(
  root: Element,
  source: string,
  node: Node,
  offset: number,
  edge: "start" | "end",
): number | null {
  const span = hostElement(node)?.closest(TEXT_SPAN_SELECTOR);
  const index = span && root.contains(span) ? charIndexInSpan(span, node, offset) : null;
  if (span && index !== null) {
    const { starts, ends } = alignmentOf(span, source);
    if (edge === "start" && index < starts.length) return starts[index] ?? null;
    if (edge === "end" && index > 0) return ends[index - 1] ?? null;
    return snap(root, source, span, edge === "start" ? span.childNodes.length : 0, edge);
  }
  return snap(root, source, node, offset, edge);
}

function textBetween(doc: Document, aNode: Node, aOffset: number, bNode: Node, bOffset: number): string {
  if (comparePoints(doc, aNode, aOffset, bNode, bOffset) >= 0) return "";
  const range = doc.createRange();
  range.setStart(aNode, aOffset);
  range.setEnd(bNode, bOffset);
  return range.toString();
}

function markupAncestors(root: Element, node: Node): Element[] {
  const found: Element[] = [];
  for (
    let element = node.parentElement?.closest(MARKUP_SELECTOR);
    element && root.contains(element) && element !== root;
    element = element.parentElement?.closest(MARKUP_SELECTOR)
  ) {
    found.push(element);
  }
  return found;
}

// A selection that fully covers the end (or start) of **bold** or `code` includes the closing (or opening)
// delimiter, so the quote stays balanced markdown.
function balance(root: Element, range: Range, start: number, end: number): SourceRange {
  const doc = root.ownerDocument;
  let balancedStart = start;
  let balancedEnd = end;
  for (const element of markupAncestors(root, range.endContainer)) {
    const coversEnd = textBetween(doc, range.endContainer, range.endOffset, element, element.childNodes.length) === "";
    const beginsOutside = textBetween(doc, range.startContainer, range.startOffset, element, 0) !== "";
    if (!coversEnd || !beginsOutside) break;
    balancedEnd = Math.max(balancedEnd, spanBounds(element).end);
  }
  for (const element of markupAncestors(root, range.startContainer)) {
    const coversStart = textBetween(doc, element, 0, range.startContainer, range.startOffset) === "";
    const endsOutside =
      textBetween(doc, element, element.childNodes.length, range.endContainer, range.endOffset) !== "";
    if (!coversStart || !endsOutside) break;
    balancedStart = Math.min(balancedStart, spanBounds(element).start);
  }
  return { start: balancedStart, end: balancedEnd };
}

function nonEmptyTextNodes(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue) texts.push(node as Text);
  }
  return texts;
}

function tightenToText(root: Element, selection: Range): Range {
  const doc = root.ownerDocument;
  const texts = nonEmptyTextNodes(root);
  const first = texts.find(
    (node) => comparePoints(doc, selection.startContainer, selection.startOffset, node, node.length) < 0,
  );
  const last = texts.findLast((node) => comparePoints(doc, node, 0, selection.endContainer, selection.endOffset) < 0);
  if (!first || !last) return selection;
  const tight = doc.createRange();
  const startInside = comparePoints(doc, first, 0, selection.startContainer, selection.startOffset) < 0;
  const endInside = comparePoints(doc, selection.endContainer, selection.endOffset, last, last.length) < 0;
  tight.setStart(first, startInside ? selection.startOffset : 0);
  tight.setEnd(last, endInside ? selection.endOffset : last.length);
  return tight.collapsed ? selection : tight;
}

export function domRangeToSource(root: Element, source: string, selection: Range): SourceRange | null {
  const range = tightenToText(root, selection);
  const start = domPointToSource(root, source, range.startContainer, range.startOffset, "start");
  const end = domPointToSource(root, source, range.endContainer, range.endOffset, "end");
  if (start === null || end === null || end <= start) return null;
  return balance(root, range, start, end);
}

function pointAtChar(span: Element, charIndex: number): [Node, number] {
  const walker = span.ownerDocument.createTreeWalker(span, SHOW_TEXT);
  let remaining = charIndex;
  let last: Node | null = null;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const length = text.nodeValue?.length ?? 0;
    if (remaining <= length) return [text, remaining];
    remaining -= length;
    last = text;
  }
  return last ? [last, last.nodeValue?.length ?? 0] : [span, 0];
}

export function sourceToDomRange(root: Element, source: string, start: number, end: number): Range | null {
  const spans = textSpans(root);
  const first = spans.find((span) => spanBounds(span).end > start);
  const last = spans.findLast((span) => spanBounds(span).start < end);
  if (!first || !last) return null;
  const startChar = alignmentOf(first, source).ends.findIndex((charEnd) => charEnd > start);
  const endChar = alignmentOf(last, source).starts.findLastIndex((charStart) => charStart < end) + 1;
  const range = root.ownerDocument.createRange();
  range.setStart(...pointAtChar(first, Math.max(startChar, 0)));
  range.setEnd(...pointAtChar(last, endChar));
  return range.collapsed ? null : range;
}
