import type { DocsIndex, IndexedDoc, ProjectIndex, RepoIndex } from "@timthink/server";
import { isArchived } from "./archive";

export function findRepo(index: DocsIndex | undefined, name: string | undefined): RepoIndex | undefined {
  return name ? index?.repos.find((repo) => repo.name === name) : undefined;
}

export function findProject(repo: RepoIndex | undefined, name: string | undefined): ProjectIndex | undefined {
  return name ? repo?.projects.find((project) => project.name === name) : undefined;
}

export function repoDocs(repo: RepoIndex): IndexedDoc[] {
  return [...repo.projects.flatMap((project) => project.docs), ...repo.ungrouped];
}

export function allDocs(index: DocsIndex): IndexedDoc[] {
  return index.repos.flatMap(repoDocs);
}

export function recentDocs(index: DocsIndex, limit: number): IndexedDoc[] {
  return allDocs(index)
    .filter((doc) => !isArchived(doc))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

export function findDoc(index: DocsIndex | undefined, path: string): IndexedDoc | undefined {
  if (!index) return undefined;
  return allDocs(index).find((doc) => doc.path === path);
}
