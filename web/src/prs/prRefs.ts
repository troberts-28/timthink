const PR_HREF = [
  /app\.graphite\.(?:com|dev)\/github\/pr\/([\w.-]+)\/([\w.-]+)\/(\d+)/,
  /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/,
];

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export function prRefFromHref(href: string): PrRef | null {
  for (const pattern of PR_HREF) {
    const match = pattern.exec(href);
    if (match?.[1] && match[2] && match[3]) return { owner: match[1], repo: match[2], number: Number(match[3]) };
  }
  return null;
}

export function prRefKey({ owner, repo, number }: PrRef): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
}
