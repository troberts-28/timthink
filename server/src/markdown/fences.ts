export interface Fence {
  lang: string;
  meta: string;
  content: string;
  start: number;
  end: number;
  line: number;
  contentLine: number;
  closed: boolean;
}

const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;

export function parseInfoString(meta: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of meta.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)'|(\S+))/g)) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4];
    if (key && value !== undefined) attributes[key] = value;
  }
  return attributes;
}

interface OpenFence {
  marker: string;
  lang: string;
  meta: string;
  start: number;
  line: number;
  lines: string[];
}

function splitInfo(info: string): { lang: string; meta: string } {
  const trimmed = info.trim();
  const space = trimmed.search(/\s/);
  if (space === -1) return { lang: trimmed.toLowerCase(), meta: "" };
  return { lang: trimmed.slice(0, space).toLowerCase(), meta: trimmed.slice(space + 1).trim() };
}

function closes(open: OpenFence, line: string): boolean {
  const match = CLOSING_FENCE.exec(line);
  const marker = match?.[1];
  return marker !== undefined && marker[0] === open.marker[0] && marker.length >= open.marker.length;
}

export function scanFences(raw: string): Fence[] {
  const fences: Fence[] = [];
  let open: OpenFence | null = null;
  let offset = 0;
  const lines = raw.split("\n");
  lines.forEach((line, index) => {
    const lineEnd = offset + line.length + (index < lines.length - 1 ? 1 : 0);
    if (open) {
      if (closes(open, line)) {
        fences.push(finish(open, lineEnd, true));
        open = null;
      } else {
        open.lines.push(line);
      }
    } else {
      const match = OPENING_FENCE.exec(line);
      const marker = match?.[2];
      const info = match?.[3] ?? "";
      if (marker && !(marker.startsWith("`") && info.includes("`"))) {
        open = { marker, ...splitInfo(info), start: offset, line: index + 1, lines: [] };
      }
    }
    offset = lineEnd;
  });
  if (open) fences.push(finish(open, raw.length, false));
  return fences;
}

function finish(open: OpenFence, end: number, closed: boolean): Fence {
  return {
    lang: open.lang,
    meta: open.meta,
    content: open.lines.join("\n"),
    start: open.start,
    end,
    line: open.line,
    contentLine: open.line + 1,
    closed,
  };
}
