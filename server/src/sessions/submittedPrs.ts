import type { SubmittedPr } from "./types.js";

const SUBMIT_COMMAND = /(?:^|[\s;&|(])(?:gt\s+(?:submit|ss)|gh\s+pr\s+create)\b/;
const DRY_RUN = /--dry-run\b/;
const PR_URLS = [
  /https?:\/\/app\.graphite\.(?:com|dev)\/github\/pr\/([\w.-]+)\/([\w.-]+)\/(\d+)/,
  /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/,
];
const GT_BRANCH_LINE = /^\s*(?:[▸•*-]\s*)?([\w./-]+):\s+https?:\/\//;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentItems(entry: Record<string, unknown>): Record<string, unknown>[] {
  if (!isRecord(entry.message) || !Array.isArray(entry.message.content)) return [];
  return entry.message.content.filter(isRecord);
}

export function isSubmitCommand(command: string): boolean {
  return SUBMIT_COMMAND.test(command) && !DRY_RUN.test(command);
}

export function submitCommandIds(entry: Record<string, unknown>): string[] {
  if (entry.type !== "assistant") return [];
  return contentItems(entry).flatMap((item) => {
    if (item.type !== "tool_use" || item.name !== "Bash" || typeof item.id !== "string") return [];
    const input = isRecord(item.input) ? item.input : {};
    return typeof input.command === "string" && isSubmitCommand(input.command) ? [item.id] : [];
  });
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : "")).join("\n");
}

export function prsInOutput(text: string, at: string | null): SubmittedPr[] {
  const found = new Map<string, SubmittedPr>();
  for (const line of text.split("\n")) {
    for (const pattern of PR_URLS) {
      const match = pattern.exec(line);
      if (!match?.[1] || !match[2] || !match[3]) continue;
      const pr = {
        owner: match[1],
        repo: match[2],
        number: Number(match[3]),
        branch: GT_BRANCH_LINE.exec(line)?.[1] ?? null,
        at,
      };
      const key = `${pr.owner}/${pr.repo}#${pr.number}`;
      if (!found.has(key) || pr.branch) found.set(key, pr);
    }
  }
  return [...found.values()];
}

export function submittedPrsIn(entry: Record<string, unknown>, pending: Set<string>, at: string | null): SubmittedPr[] {
  if (entry.type !== "user") return [];
  return contentItems(entry).flatMap((item) => {
    if (item.type !== "tool_result" || typeof item.tool_use_id !== "string" || !pending.has(item.tool_use_id)) {
      return [];
    }
    pending.delete(item.tool_use_id);
    return prsInOutput(resultText(item.content), at);
  });
}
