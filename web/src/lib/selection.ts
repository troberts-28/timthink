import { useLocation } from "react-router";
import type { SidebarSelection } from "../components/Sidebar";

function decodeSegments(path: string): string[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

const NOTHING_SELECTED: SidebarSelection = { repo: null, project: null, docPath: null, area: null, projectId: null };

export function selectionFromPath(pathname: string): SidebarSelection {
  const [kind, first = null, ...rest] = decodeSegments(pathname);
  if (kind === "d" && first && rest.length > 0) {
    return { ...NOTHING_SELECTED, repo: first, docPath: [first, ...rest].join("/") };
  }
  if (kind === "r" && first) {
    return { ...NOTHING_SELECTED, repo: first, project: rest[0] ?? null };
  }
  if (kind === "a" && first) {
    return { ...NOTHING_SELECTED, area: first };
  }
  if (kind === "p" && first) {
    return { ...NOTHING_SELECTED, area: rest.length > 0 ? first : null, projectId: [first, ...rest].join("/") };
  }
  return NOTHING_SELECTED;
}

export function useSelection(): SidebarSelection {
  return selectionFromPath(useLocation().pathname);
}
