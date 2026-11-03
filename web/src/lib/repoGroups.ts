import type { DocsIndex, RepoIndex } from "@timthink/server";

export interface RepoSection {
  name: string | null;
  repos: RepoIndex[];
}

export function repoSections(index: DocsIndex): RepoSection[] {
  const groups = index.groups ?? [];
  if (groups.length === 0) return [{ name: null, repos: index.repos }];
  return groups
    .map((name) => ({ name, repos: index.repos.filter((repo) => (repo.group ?? null) === name) }))
    .filter((section) => section.repos.length > 0);
}

export function groupOfRepo(index: DocsIndex | undefined, repo: string): string | null {
  return index?.repos.find((entry) => entry.name === repo)?.group ?? null;
}
