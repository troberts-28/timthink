import type { AreaDetail, ProjectDetail, ProjectStack } from "@timthink/server";
import { createContext, useContext } from "react";
import { rawFileHref, resolveRelative } from "../lib/routes";

export interface PageScope {
  pagePath: string;
  ownerId: string;
  stacks: ProjectStack[];
  defaultRepo: string | null;
}

export const PageScopeContext = createContext<PageScope | null>(null);
export const ProjectContext = createContext<ProjectDetail | null>(null);
export const AreaContext = createContext<AreaDetail | null>(null);

export function usePageScope() {
  const scope = useContext(PageScopeContext);
  if (!scope) {
    throw new Error("Page primitives only work inside a project or area page");
  }
  return scope;
}

export function useProject() {
  const detail = useContext(ProjectContext);
  if (!detail) {
    throw new Error("useProject only works inside a project page");
  }
  return detail;
}

export function useArea() {
  const detail = useContext(AreaContext);
  if (!detail) {
    throw new Error("useArea only works inside an area page");
  }
  return detail;
}

export function projectPageScope(detail: ProjectDetail, pagePath: string): PageScope {
  return {
    pagePath,
    ownerId: detail.project.id,
    stacks: detail.prs.stacks,
    defaultRepo: detail.project.repos[0] ?? null,
  };
}

export function areaPageScope(detail: AreaDetail, pagePath: string): PageScope {
  return {
    pagePath,
    ownerId: detail.area.id,
    stacks: detail.projectPrs.flatMap((entry) => entry.prs.stacks),
    defaultRepo: detail.area.repos[0] ?? null,
  };
}

const ABSOLUTE_URL = /^(?:[a-z][a-z\d+.-]*:|\/)/i;

export function usePageFileHref(src: string) {
  const { pagePath } = usePageScope();
  if (ABSOLUTE_URL.test(src)) {
    return src;
  }
  const resolved = resolveRelative(pagePath, src);
  return resolved ? rawFileHref(resolved) : src;
}
