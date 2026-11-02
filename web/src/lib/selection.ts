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

export function selectionFromPath(pathname: string): SidebarSelection {
  const [kind, repo = null, ...rest] = decodeSegments(pathname);
  if (kind === "d" && repo && rest.length > 0) return { repo, project: null, docPath: [repo, ...rest].join("/") };
  if (kind === "r" && repo) return { repo, project: rest[0] ?? null, docPath: null };
  return { repo: null, project: null, docPath: null };
}

export function useSelection(): SidebarSelection {
  return selectionFromPath(useLocation().pathname);
}
