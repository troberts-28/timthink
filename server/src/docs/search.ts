import { canonicalStatus } from "./status.js";
import type { DocSummary } from "./types.js";

export interface SearchHit {
  path: string;
  title: string;
  repo: string;
  status: string | null;
  snippet: string;
  matches: number;
}

export interface SearchQuery {
  terms: string[];
  repo: string | null;
  status: string | null;
}

const SNIPPET_RADIUS = 70;
const FILTER = /^(repo|status):(\S+)$/i;

export function parseSearchQuery(input: string): SearchQuery {
  const query: SearchQuery = { terms: [], repo: null, status: null };
  for (const token of input.trim().split(/\s+/).filter(Boolean)) {
    const filter = FILTER.exec(token);
    if (filter?.[1] && filter[2]) {
      const value = filter[2].toLowerCase();
      if (filter[1].toLowerCase() === "repo") query.repo = value;
      else query.status = canonicalStatus(value);
    } else {
      query.terms.push(token.toLowerCase());
    }
  }
  return query;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

function snippetAround(text: string, lower: string, term: string): string {
  const at = lower.indexOf(term);
  if (at === -1) return "";
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + term.length + SNIPPET_RADIUS);
  const flat = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${flat}${end < text.length ? "…" : ""}`;
}

export function searchDocs(
  docs: readonly { summary: DocSummary; text: string }[],
  input: string,
  limit: number,
): SearchHit[] {
  const query = parseSearchQuery(input);
  if (query.terms.length === 0 && !query.repo && !query.status) return [];
  return docs
    .filter(({ summary }) => !query.repo || summary.repo.toLowerCase() === query.repo)
    .filter(({ summary }) => !query.status || canonicalStatus(summary.status) === query.status)
    .flatMap(({ summary, text }) => {
      const lower = text.toLowerCase();
      const title = summary.title.toLowerCase();
      if (!query.terms.every((term) => lower.includes(term) || title.includes(term))) return [];
      const matches = query.terms.reduce((total, term) => total + countOccurrences(lower, term), 0);
      const titleHits = query.terms.filter((term) => title.includes(term)).length;
      const bodyTerm = query.terms.find((term) => lower.includes(term));
      return [
        {
          hit: {
            path: summary.path,
            title: summary.title,
            repo: summary.repo,
            status: summary.status,
            snippet: bodyTerm ? snippetAround(text, lower, bodyTerm) : "",
            matches,
          },
          score: titleHits * 10 + Math.min(matches, 20),
          mtime: summary.mtime,
        },
      ];
    })
    .sort((a, b) => b.score - a.score || b.mtime - a.mtime)
    .slice(0, limit)
    .map(({ hit }) => hit);
}
