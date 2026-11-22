import type { ProjectDetail } from "@timthink/server";
import { createContext, useContext } from "react";
import { rawFileHref, resolveRelative } from "../lib/routes";

export const ProjectContext = createContext<ProjectDetail | null>(null);

export function useProject() {
  const detail = useContext(ProjectContext);
  if (!detail) {
    throw new Error("useProject only works inside a project page");
  }
  return detail;
}

const ABSOLUTE_URL = /^(?:[a-z][a-z\d+.-]*:|\/)/i;

export function useProjectFileHref(src: string) {
  const { project } = useProject();
  if (ABSOLUTE_URL.test(src)) {
    return src;
  }
  const resolved = resolveRelative(`${project.id}/project.page.tsx`, src);
  return resolved ? rawFileHref(resolved) : src;
}
