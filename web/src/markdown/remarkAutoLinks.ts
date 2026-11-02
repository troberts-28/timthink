import type { InlineCode, Link, PhrasingContent, Root, Text } from "mdast";
import type { Point, Position } from "unist";
import { SKIP, visit } from "unist-util-visit";
import { docHref } from "../lib/routes";
import {
  basename,
  findTextLinks,
  type GithubRepoRef,
  isCodePath,
  type PrLinkHost,
  prUrlForGithubPull,
  type RepoLinkTarget,
} from "./linkPatterns";

export interface AutoLinkOptions {
  github: GithubRepoRef | null;
  prLinks: PrLinkHost;
  docPath: string;
  repoDocPaths: readonly string[];
  knownRepos?: ReadonlyMap<string, RepoLinkTarget>;
}

const SKIPPED_TEXT_PARENTS = new Set(["link", "linkReference"]);

function dirname(filePath: string): string {
  return filePath.slice(0, filePath.lastIndexOf("/"));
}

export function createPlanResolver(
  docPath: string,
  repoDocPaths: readonly string[],
): (fileName: string) => string | null {
  const byName = new Map<string, string[]>();
  for (const candidate of repoDocPaths) {
    const name = basename(candidate);
    byName.set(name, [...(byName.get(name) ?? []), candidate]);
  }
  const currentDir = dirname(docPath);
  return (fileName) => {
    const candidates = byName.get(fileName);
    if (!candidates) return null;
    return candidates.find((candidate) => dirname(candidate) === currentDir) ?? candidates[0] ?? null;
  };
}

function advance(point: Point, text: string): Point {
  let { line, column } = point;
  for (const char of text) {
    if (char === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column, offset: (point.offset ?? 0) + text.length };
}

function sliceRange(node: Text, start: number, end: number): Position | undefined {
  const position = node.position;
  if (position?.start.offset === undefined || position.end.offset === undefined) return undefined;
  if (position.end.offset - position.start.offset !== node.value.length) return undefined;
  const from = advance(position.start, node.value.slice(0, start));
  return { start: from, end: advance(from, node.value.slice(start, end)) };
}

function textNode(source: Text, start: number, end: number): Text {
  const position = sliceRange(source, start, end);
  return { type: "text", value: source.value.slice(start, end), ...(position ? { position } : {}) };
}

function linkNode(source: Text, start: number, end: number, url: string, properties: Record<string, string>): Link {
  const position = sliceRange(source, start, end);
  return {
    type: "link",
    url,
    children: [textNode(source, start, end)],
    data: { hProperties: properties },
    ...(position ? { position } : {}),
  };
}

function splitText(
  node: Text,
  options: AutoLinkOptions,
  resolvePlan: (name: string) => string | null,
): PhrasingContent[] | null {
  const links = findTextLinks(node.value, {
    github: options.github,
    prLinks: options.prLinks,
    hasPlan: (name) => resolvePlan(name) !== null,
    knownRepo: (name) => options.knownRepos?.get(name) ?? null,
  });
  if (links.length === 0) return null;
  const parts: PhrasingContent[] = [];
  let cursor = 0;
  for (const link of links) {
    if (link.start > cursor) parts.push(textNode(node, cursor, link.start));
    if (link.kind === "pr") {
      parts.push(linkNode(node, link.start, link.end, link.url, { dataPr: "true" }));
    } else {
      const planPath = resolvePlan(link.fileName);
      if (planPath) parts.push(linkNode(node, link.start, link.end, docHref(planPath), { dataPlanRef: planPath }));
    }
    cursor = link.end;
  }
  if (cursor < node.value.length) parts.push(textNode(node, cursor, node.value.length));
  return parts;
}

function planLinkForCode(node: InlineCode, planPath: string): Link {
  return {
    type: "link",
    url: docHref(planPath),
    children: [node],
    data: { hProperties: { dataPlanRef: planPath } },
    ...(node.position ? { position: node.position } : {}),
  };
}

export function remarkAutoLinks(options: AutoLinkOptions) {
  const resolvePlan = createPlanResolver(options.docPath, options.repoDocPaths);
  return (tree: Root): void => {
    visit(tree, (node, index, parent) => {
      if (!parent || index === undefined) return;
      if (node.type === "link") {
        const pullUrl = prUrlForGithubPull(node.url, options.prLinks);
        if (pullUrl) {
          node.url = pullUrl;
          node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataPr: "true" } };
        }
        return SKIP;
      }
      if (node.type === "inlineCode") {
        const planPath = node.value.toLowerCase().endsWith(".md") ? resolvePlan(basename(node.value)) : null;
        if (planPath) {
          parent.children.splice(index, 1, planLinkForCode(node, planPath));
          return SKIP;
        }
        if (isCodePath(node.value)) {
          node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataCodeRef: node.value } };
        }
        return;
      }
      if (node.type === "text" && !SKIPPED_TEXT_PARENTS.has(parent.type)) {
        const parts = splitText(node, options, resolvePlan);
        if (!parts) return;
        parent.children.splice(index, 1, ...parts);
        return [SKIP, index + parts.length];
      }
      return;
    });
  };
}
