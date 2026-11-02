import type { DocSummary, DocsIndex, ProjectIndex, RepoIndex } from "@timthink/server";

export function findRepo(index: DocsIndex | undefined, name: string | undefined): RepoIndex | undefined {
  return name ? index?.repos.find((repo) => repo.name === name) : undefined;
}

export function findProject(repo: RepoIndex | undefined, name: string | undefined): ProjectIndex | undefined {
  return name ? repo?.projects.find((project) => project.name === name) : undefined;
}

export function repoDocs(repo: RepoIndex): DocSummary[] {
  return [...repo.projects.flatMap((project) => project.docs), ...repo.ungrouped];
}

export function allDocs(index: DocsIndex): DocSummary[] {
  return index.repos.flatMap(repoDocs);
}

export function recentDocs(index: DocsIndex, limit: number): DocSummary[] {
  return allDocs(index)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

export function findDoc(index: DocsIndex | undefined, path: string): DocSummary | undefined {
  if (!index) return undefined;
  return allDocs(index).find((doc) => doc.path === path);
}
