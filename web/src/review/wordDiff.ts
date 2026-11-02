export type DiffPart = { kind: "same" | "removed" | "added"; text: string };

const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;
const MAX_CELLS = 4_000_000;

function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

function pushPart(parts: DiffPart[], kind: DiffPart["kind"], text: string): void {
  const last = parts.at(-1);
  if (last && last.kind === kind) last.text += text;
  else if (text) parts.push({ kind, text });
}

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length * b.length > MAX_CELLS) {
    return [
      { kind: "removed", text: before },
      { kind: "added", text: after },
    ].filter((part): part is DiffPart => part.text !== "");
  }
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        a[i] === b[j]
          ? (lengths[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lengths[(i + 1) * width + j] ?? 0, lengths[i * width + j + 1] ?? 0);
    }
  }
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pushPart(parts, "same", a[i] ?? "");
      i += 1;
      j += 1;
    } else if ((lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0)) {
      pushPart(parts, "removed", a[i] ?? "");
      i += 1;
    } else {
      pushPart(parts, "added", b[j] ?? "");
      j += 1;
    }
  }
  for (; i < a.length; i += 1) pushPart(parts, "removed", a[i] ?? "");
  for (; j < b.length; j += 1) pushPart(parts, "added", b[j] ?? "");
  return parts;
}
