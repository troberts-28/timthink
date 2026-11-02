export interface GithubRepoRef {
  owner: string;
  repo: string;
}

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "jsonc",
  "json5",
  "md",
  "mdx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "swift",
  "m",
  "mm",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "fs",
  "php",
  "scala",
  "clj",
  "ex",
  "exs",
  "erl",
  "hs",
  "lua",
  "dart",
  "r",
  "jl",
  "sql",
  "graphql",
  "gql",
  "prisma",
  "proto",
  "yml",
  "yaml",
  "toml",
  "ini",
  "env",
  "lock",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "htm",
  "vue",
  "svelte",
  "astro",
  "xml",
  "plist",
  "gradle",
  "tf",
  "hcl",
  "dockerfile",
  "txt",
  "csv",
  "tsv",
  "snap",
]);

const CODE_PATH = /^(?:[\w@.~()[\]+-]+\/)*([\w@.~()[\]+-]*[A-Za-z][\w@.~()[\]+-]*)\.([A-Za-z0-9]+)(?::\d+(?::\d+)?)?$/;

export function isCodePath(value: string): boolean {
  if (value.length > 300 || /\s|:\/\//.test(value) || value.startsWith("-")) return false;
  const match = CODE_PATH.exec(value);
  const extension = match?.[2]?.toLowerCase();
  return extension !== undefined && CODE_EXTENSIONS.has(extension);
}

export type PrLinkHost = "graphite" | "github";

export function prUrl(github: GithubRepoRef, number: string, host: PrLinkHost): string {
  if (host === "github") return `https://github.com/${github.owner}/${github.repo}/pull/${number}`;
  return `https://app.graphite.com/github/pr/${github.owner}/${github.repo}/${number}`;
}

const GITHUB_PULL_URL = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?(?:[?#].*)?$/;

export function prUrlForGithubPull(url: string, host: PrLinkHost): string | null {
  const match = GITHUB_PULL_URL.exec(url);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return prUrl({ owner: match[1], repo: match[2] }, match[3], host);
}

export type TextLink =
  | { kind: "pr"; start: number; end: number; url: string }
  | { kind: "plan"; start: number; end: number; fileName: string };

export interface RepoLinkTarget {
  github: GithubRepoRef;
  prLinks: PrLinkHost;
}

const PR_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  toUrl: (match: RegExpMatchArray, options: TextLinkOptions) => string | null;
}> = [
  {
    pattern: /(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g,
    toUrl: (match, { prLinks }) =>
      match[1] && match[2] && match[3] ? prUrl({ owner: match[1], repo: match[2] }, match[3], prLinks) : null,
  },
  {
    pattern: /(?<![\w/.#-])([A-Za-z][\w.-]*)#(\d+)\b/g,
    toUrl: (match, { knownRepo }) => {
      const target = match[1] ? knownRepo?.(match[1]) : null;
      return target && match[2] ? prUrl(target.github, match[2], target.prLinks) : null;
    },
  },
  {
    pattern: /\b[Pp][Rr](?:[ -]#?|#)(\d+)\b/g,
    toUrl: (match, { github, prLinks }) => (github && match[1] ? prUrl(github, match[1], prLinks) : null),
  },
  {
    pattern: /(?<![\w&/#])#(\d{2,})\b/g,
    toUrl: (match, { github, prLinks }) => (github && match[1] ? prUrl(github, match[1], prLinks) : null),
  },
];

const PLAN_FILE_NAME = /(?<![\w/.-])([\w.-]*[A-Za-z][\w.-]*\.md)\b/g;

export interface TextLinkOptions {
  github: GithubRepoRef | null;
  prLinks: PrLinkHost;
  hasPlan: (fileName: string) => boolean;
  knownRepo?: (name: string) => RepoLinkTarget | null;
}

function overlaps(candidate: TextLink, taken: readonly TextLink[]): boolean {
  return taken.some((link) => candidate.start < link.end && link.start < candidate.end);
}

export function findTextLinks(text: string, options: TextLinkOptions): TextLink[] {
  const links: TextLink[] = [];
  for (const { pattern, toUrl } of PR_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const url = toUrl(match, options);
      const start = match.index ?? 0;
      if (!url) continue;
      const link: TextLink = { kind: "pr", start, end: start + match[0].length, url };
      if (!overlaps(link, links)) links.push(link);
    }
  }
  for (const match of text.matchAll(PLAN_FILE_NAME)) {
    const fileName = match[1];
    if (!fileName || !options.hasPlan(fileName)) continue;
    const start = match.index ?? 0;
    const link: TextLink = { kind: "plan", start, end: start + match[0].length, fileName };
    if (!overlaps(link, links)) links.push(link);
  }
  return links.sort((a, b) => a.start - b.start);
}

export function basename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf("/") + 1);
}
