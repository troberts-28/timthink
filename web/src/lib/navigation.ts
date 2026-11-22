import type { DocsIndex, IndexedDoc, SearchHit } from "@timthink/server";
import type { SidebarSelection } from "../components/Sidebar";
import { isArchived } from "./archive";
import { allDocs, findDoc, findProject, findProjectEntry, findRepo } from "./indexNav";
import { areaHref, projectEntryHref, projectHref, repoHref } from "./routes";

const INBOX_HREF = "/";
const MAX_RESULTS = 40;

export function parentHref(index: DocsIndex | undefined, selection: SidebarSelection): string | null {
  const { repo, project, docPath } = selection;
  if (selection.projectId) {
    return selection.area ? areaHref(selection.area) : INBOX_HREF;
  }
  if (selection.area) {
    return INBOX_HREF;
  }
  if (!repo) return null;
  const projectDoc = docPath ? findDoc(index, docPath) : undefined;
  if (projectDoc?.projectId && findProjectEntry(index, projectDoc.projectId)) {
    return projectEntryHref(projectDoc.projectId);
  }
  if (index?.areas.some((area) => area.id === repo)) {
    return areaHref(repo);
  }
  if (docPath) {
    const doc = findDoc(index, docPath);
    const folder = doc?.project && doc.project !== repo ? findProject(findRepo(index, repo), doc.project) : undefined;
    return folder && folder.docs.length > 1 ? projectHref(repo, folder.name) : repoHref(repo);
  }
  return project ? repoHref(repo) : INBOX_HREF;
}

export type SearchResult =
  | { kind: "repo"; repo: string }
  | { kind: "plan"; doc: IndexedDoc }
  | { kind: "text"; hit: SearchHit };

function haystack(doc: IndexedDoc): string {
  return `${doc.title} ${doc.path}`.toLowerCase();
}

function planScore(doc: IndexedDoc, terms: readonly string[]): number {
  const title = doc.title.toLowerCase();
  const titleHits = terms.filter((term) => title.includes(term)).length;
  const startsWith = terms[0] !== undefined && title.startsWith(terms[0]) ? 1 : 0;
  return titleHits * 2 + startsWith + (isArchived(doc) ? -3 : 0);
}

const FILTER_TOKEN = /^(repo|status):/i;

export function searchIndex(index: DocsIndex, query: string): SearchResult[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term && !FILTER_TOKEN.test(term));
  if (terms.length === 0 && FILTER_TOKEN.test(query.trim())) return [];
  const docs = allDocs(index);
  if (terms.length === 0) {
    return docs
      .filter((doc) => !isArchived(doc))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, MAX_RESULTS)
      .map((doc) => ({ kind: "plan", doc }));
  }
  const repos: SearchResult[] = index.repos
    .filter((repo) => terms.every((term) => repo.name.toLowerCase().includes(term)))
    .map((repo) => ({ kind: "repo", repo: repo.name }));
  const plans: SearchResult[] = docs
    .filter((doc) => terms.every((term) => haystack(doc).includes(term)))
    .sort((a, b) => planScore(b, terms) - planScore(a, terms) || b.mtime - a.mtime)
    .slice(0, MAX_RESULTS)
    .map((doc) => ({ kind: "plan", doc }));
  return [...repos, ...plans];
}

export function withTextHits(results: readonly SearchResult[], hits: readonly SearchHit[]): SearchResult[] {
  const shown = new Set(results.flatMap((result) => (result.kind === "plan" ? [result.doc.path] : [])));
  return [...results, ...hits.filter((hit) => !shown.has(hit.path)).map((hit) => ({ kind: "text" as const, hit }))];
}
