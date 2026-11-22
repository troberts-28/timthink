import type { DocDetail, DocSummary, DocsIndex } from "@timthink/server";
import { useMemo } from "react";
import { codeRepoFor, neighbourDocPaths } from "../lib/indexNav";
import type { RepoLinkTarget } from "../markdown/linkPatterns";
import { markdownToHast, type RenderedMarkdown } from "../markdown/pipeline";
import type { AutoLinkOptions } from "../markdown/remarkAutoLinks";

export function useAutoLinkOptions(doc: DocSummary | undefined, index: DocsIndex | undefined): AutoLinkOptions {
  const codeRepo = doc ? codeRepoFor(index, doc) : undefined;
  const github = codeRepo?.github ?? null;
  const prLinks = codeRepo?.prLinks ?? "graphite";
  const docPath = doc?.path ?? "";
  const repoDocPaths = useMemo(() => (doc ? neighbourDocPaths(index, doc) : []), [doc, index]);
  const knownRepos = useMemo(() => linkTargets(index), [index]);
  return useMemo(
    () => ({ github, prLinks, docPath, repoDocPaths, knownRepos }),
    [github, prLinks, docPath, repoDocPaths, knownRepos],
  );
}

export function useRenderedMarkdown(doc: DocDetail | undefined, index: DocsIndex | undefined): RenderedMarkdown | null {
  const options = useAutoLinkOptions(doc?.summary, index);
  return useMemo(() => (doc ? markdownToHast(doc.raw, options) : null), [doc, options]);
}

function linkTargets(index: DocsIndex | undefined) {
  const targets = new Map<string, RepoLinkTarget>();
  for (const [name, info] of Object.entries(index?.codeRepos ?? {})) {
    if (info.github) {
      targets.set(name, { github: info.github, prLinks: info.prLinks });
    }
  }
  for (const repo of index?.repos ?? []) {
    if (repo.github && !targets.has(repo.name)) {
      targets.set(repo.name, { github: repo.github, prLinks: repo.prLinks });
    }
  }
  return targets;
}
