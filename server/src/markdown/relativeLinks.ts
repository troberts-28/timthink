import type { Fence } from "./fences.js";

export interface LinkTarget {
  target: string;
  start: number;
  line: number;
  image: boolean;
}

const INLINE_LINK = /!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/dg;
const LINK_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/d;
const INLINE_CODE = /(`+)[\s\S]*?\1/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i;
const TEMPLATED = /[{}$]/;
const DEMO_SRC = /\bsrc=(?:"([^"]*)"|'([^']*)'|(\S+))/d;

export function linkTargets(raw: string, fences: readonly Fence[]): LinkTarget[] {
  const inFence = (offset: number) => fences.some((fence) => offset >= fence.start && offset < fence.end);
  const found: LinkTarget[] = [];
  let offset = 0;
  raw.split("\n").forEach((line, index) => {
    if (!inFence(offset)) {
      const prose = line.replace(INLINE_CODE, (code) => " ".repeat(code.length));
      for (const match of prose.matchAll(INLINE_LINK)) {
        const span = match.indices?.[1];
        if (match[1] && span) {
          found.push({ target: match[1], start: offset + span[0], line: index + 1, image: match[0].startsWith("!") });
        }
      }
      const definition = LINK_DEFINITION.exec(prose);
      const span = definition?.indices?.[1];
      if (definition?.[1] && span) {
        found.push({ target: definition[1], start: offset + span[0], line: index + 1, image: false });
      }
    }
    offset += line.length + 1;
  });
  return found;
}

export function demoSources(raw: string, fences: readonly Fence[]): LinkTarget[] {
  return fences
    .filter((fence) => fence.lang === "demo")
    .flatMap((fence) => {
      const lineEnd = raw.indexOf("\n", fence.start);
      const opening = raw.slice(fence.start, lineEnd === -1 ? raw.length : lineEnd);
      const match = DEMO_SRC.exec(opening);
      const group = [1, 2, 3].find((index) => match?.[index] !== undefined);
      const span = group === undefined ? undefined : match?.indices?.[group];
      const target = group === undefined ? undefined : match?.[group];
      return target && span ? [{ target, start: fence.start + span[0], line: fence.line, image: false }] : [];
    });
}

export function relativeTarget(target: string): string | null {
  if (EXTERNAL.test(target) || TEMPLATED.test(target)) return null;
  const withoutFragment = target.split(/[?#]/)[0] ?? "";
  if (!withoutFragment) return null;
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
}
