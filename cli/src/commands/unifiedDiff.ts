type DiffLine = { kind: " " | "-" | "+"; text: string; oldLine: number; newLine: number };

const CONTEXT_LINES = 3;

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function commonSuffixLengths(before: readonly string[], after: readonly string[]): (i: number, j: number) => number {
  const cols = after.length + 1;
  const table = new Uint32Array((before.length + 1) * cols);
  const at = (i: number, j: number): number => table[i * cols + j] ?? 0;
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = before[i] === after[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  return at;
}

function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  const common = commonSuffixLengths(before, after);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const deletable = i < before.length;
    const insertable = j < after.length;
    if (deletable && insertable && before[i] === after[j]) {
      lines.push({ kind: " ", text: before[i] ?? "", oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (deletable && (!insertable || common(i + 1, j) >= common(i, j + 1))) {
      lines.push({ kind: "-", text: before[i] ?? "", oldLine: i + 1, newLine: j });
      i += 1;
    } else {
      lines.push({ kind: "+", text: after[j] ?? "", oldLine: i, newLine: j + 1 });
      j += 1;
    }
  }
  return lines;
}

function hunkRanges(lines: readonly DiffLine[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  lines.forEach((line, position) => {
    if (line.kind === " ") return;
    const start = Math.max(0, position - CONTEXT_LINES);
    const end = Math.min(lines.length, position + CONTEXT_LINES + 1);
    const last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  });
  return ranges;
}

function hunkHeader(slice: readonly DiffLine[]): string {
  const oldLines = slice.filter((line) => line.kind !== "+");
  const newLines = slice.filter((line) => line.kind !== "-");
  const oldStart = oldLines[0]?.oldLine ?? slice[0]?.oldLine ?? 0;
  const newStart = newLines[0]?.newLine ?? slice[0]?.newLine ?? 0;
  return `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`;
}

export function unifiedDiff(before: string, after: string, oldLabel: string, newLabel: string): string {
  if (before === after) return "";
  const lines = diffLines(splitLines(before), splitLines(after));
  const output = [`--- ${oldLabel}`, `+++ ${newLabel}`];
  for (const [start, end] of hunkRanges(lines)) {
    const slice = lines.slice(start, end);
    output.push(hunkHeader(slice), ...slice.map((line) => `${line.kind}${line.text}`));
  }
  return `${output.join("\n")}\n`;
}
