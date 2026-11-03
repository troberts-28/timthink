import type { RepoGroupConfig } from "../config.js";
import type { GithubRepo } from "../docs/types.js";

export const FALLBACK_GROUP = "Other";

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function groupNames(groups: readonly RepoGroupConfig[] | null, assigned: Iterable<string | null>): string[] {
  if (!groups) return [];
  const names = groups.map((group) => group.name);
  for (const name of assigned) {
    if (name !== null && !names.includes(name)) names.push(name);
  }
  return names;
}

export function groupForRepo(
  groups: readonly RepoGroupConfig[] | null,
  repo: string,
  github: GithubRepo | null,
): string | null {
  if (!groups) return null;
  const explicit = groups.find((group) => group.repos.some((name) => sameName(name, repo)));
  if (explicit) return explicit.name;
  const byOwner = github ? groups.find((group) => group.owners.some((owner) => sameName(owner, github.owner))) : null;
  if (byOwner) return byOwner.name;
  return groups.find((group) => group.default)?.name ?? FALLBACK_GROUP;
}
