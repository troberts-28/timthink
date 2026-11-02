const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export interface Heading {
  depth: number;
  text: string;
  start: number;
  end: number;
}

export interface Section {
  headingPath: string[];
  start: number;
  end: number;
}

interface Line {
  text: string;
  start: number;
}

function* linesOf(source: string, from: number): Generator<Line> {
  let start = from;
  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline === -1 ? source.length : newline;
    yield { text: source.slice(start, end).replace(/\r$/, ""), start };
    start = end + 1;
  }
}

export function frontmatterEnd(source: string): number {
  return FRONTMATTER.exec(source)?.[0].length ?? 0;
}

export function findHeadings(source: string): Heading[] {
  const headings: Heading[] = [];
  let fence: string | null = null;
  for (const line of linesOf(source, frontmatterEnd(source))) {
    const fenceMatch = FENCE.exec(line.text);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = ATX_HEADING.exec(line.text);
    if (heading?.[1]) {
      headings.push({
        depth: heading[1].length,
        text: (heading[2] ?? "").trim(),
        start: line.start,
        end: line.start + line.text.length,
      });
    }
  }
  return headings;
}

function pathAt(headings: readonly Heading[], index: number): string[] {
  const stack: Heading[] = [];
  for (const heading of headings.slice(0, index + 1)) {
    while (stack.length > 0 && (stack.at(-1)?.depth ?? 0) >= heading.depth) stack.pop();
    stack.push(heading);
  }
  return stack.map((heading) => heading.text);
}

export function headingPathAt(source: string, offset: number): string[] {
  const headings = findHeadings(source);
  const index = headings.findLastIndex((heading) => heading.start <= offset);
  return index === -1 ? [] : pathAt(headings, index);
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((part, position) => part === b[position]);
}

export function findSection(source: string, headingPath: readonly string[]): Section | null {
  if (headingPath.length === 0) return null;
  const headings = findHeadings(source);
  const index = headings.findIndex((_, position) => samePath(pathAt(headings, position), headingPath));
  const heading = headings[index];
  if (!heading) return null;
  const next = headings.slice(index + 1).find((candidate) => candidate.depth <= heading.depth);
  return { headingPath: [...headingPath], start: heading.start, end: next?.start ?? source.length };
}

export function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (
    let position = source.indexOf("\n");
    position !== -1 && position < offset;
    position = source.indexOf("\n", position + 1)
  ) {
    line += 1;
  }
  return line;
}
