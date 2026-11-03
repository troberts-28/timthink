import { parse as parseYaml } from "yaml";

export type FrontmatterData = Record<string, unknown>;

export interface ParsedFrontmatter {
  data: FrontmatterData;
  body: string;
  error: string | null;
}

const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function isPlainObject(value: unknown): value is FrontmatterData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(raw);
  if (!match) return { data: {}, body: raw, error: null };
  const body = raw.slice(match[0].length);
  try {
    const parsed: unknown = parseYaml(match[1] ?? "");
    if (parsed === null || parsed === undefined) return { data: {}, body, error: null };
    if (!isPlainObject(parsed)) return { data: {}, body, error: "Frontmatter is not a mapping" };
    return { data: parsed, body, error: null };
  } catch (error) {
    const message = error instanceof Error ? (error.message.split("\n")[0] ?? "Invalid YAML") : "Invalid YAML";
    return { data: {}, body, error: message };
  }
}

export function frontmatterString(data: FrontmatterData, key: string): string | null {
  const value = data[key];
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return null;
}

export function frontmatterList(data: FrontmatterData, key: string): string[] {
  const value = data[key];
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => {
    if (typeof item === "number") return [String(item)];
    if (typeof item === "string") return item.split(/[\s,]+/).filter(Boolean);
    return [];
  });
}
