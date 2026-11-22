import type {
  AreaEntry,
  CodeRepoInfo,
  DocSummary,
  DocsIndex,
  IndexedDoc,
  ProjectEntry,
  ProjectIndex,
  RepoIndex,
} from "@timthink/server";
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
  return [
    ...index.areas.flatMap((area) => [...area.docs, ...area.projects.flatMap((project) => project.docs)]),
    ...index.projects.flatMap((project) => project.docs),
    ...index.repos.flatMap(repoDocs),
  ];
}

export function allProjects(index: DocsIndex): ProjectEntry[] {
  return [...index.areas.flatMap((area) => area.projects), ...index.projects];
}

export function findProjectEntry(index: DocsIndex | undefined, id: string | null | undefined) {
  return id && index ? allProjects(index).find((project) => project.id === id) : undefined;
}

export function findArea(index: DocsIndex | undefined, id: string | null | undefined): AreaEntry | undefined {
  return id ? index?.areas.find((area) => area.id === id) : undefined;
}

export function codeRepoFor(index: DocsIndex | undefined, doc: DocSummary): CodeRepoInfo | undefined {
  return index?.codeRepos[doc.codeRepo];
}

export function neighbourDocPaths(index: DocsIndex | undefined, doc: DocSummary) {
  if (!index) {
    return [];
  }
  const project = findProjectEntry(index, doc.projectId);
  if (project) {
    return project.docs.map((entry) => entry.path);
  }
  const area = findArea(index, doc.repo);
  if (area) {
    return area.docs.map((entry) => entry.path);
  }
  const repo = findRepo(index, doc.repo);
  return repo ? repoDocs(repo).map((entry) => entry.path) : [];
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
