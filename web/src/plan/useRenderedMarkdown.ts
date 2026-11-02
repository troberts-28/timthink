import type { DocDetail, DocsIndex, RepoIndex } from "@timthink/server";
import { useMemo } from "react";
import { repoDocs } from "../lib/indexNav";
import type { RepoLinkTarget } from "../markdown/linkPatterns";
import { markdownToHast, type RenderedMarkdown } from "../markdown/pipeline";

function linkTargets(index: DocsIndex | undefined): ReadonlyMap<string, RepoLinkTarget> {
  const targets = new Map<string, RepoLinkTarget>();
  for (const repo of index?.repos ?? []) {
    if (repo.github) targets.set(repo.name, { github: repo.github, prLinks: repo.prLinks });
  }
  return targets;
}

export function useRenderedMarkdown(
  doc: DocDetail | undefined,
  repo: RepoIndex | undefined,
  index: DocsIndex | undefined,
): RenderedMarkdown | null {
  const github = repo?.github ?? null;
  const prLinks = repo?.prLinks ?? "graphite";
  const repoDocPaths = useMemo(() => (repo ? repoDocs(repo).map((entry) => entry.path) : []), [repo]);
  const knownRepos = useMemo(() => linkTargets(index), [index]);
  return useMemo(() => {
    if (!doc) return null;
    return markdownToHast(doc.raw, { github, prLinks, docPath: doc.summary.path, repoDocPaths, knownRepos });
  }, [doc, github, prLinks, repoDocPaths, knownRepos]);
}
