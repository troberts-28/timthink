import type { DocsIndex, IndexedDoc } from "@timthink/server";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { isArchived } from "./archive";
import { repoSections } from "./repoGroups";
import { docHref } from "./routes";

export interface NavEntry {
  path: string;
  archived: boolean;
}

export function sidebarOrder(index: DocsIndex): NavEntry[] {
  const entries = (docs: readonly IndexedDoc[]) => docs.map((doc) => ({ path: doc.path, archived: isArchived(doc) }));
  return repoSections(index).flatMap((section) =>
    section.repos
      .filter((repo) => !repo.hidden)
      .flatMap((repo) => [...repo.projects.flatMap((project) => entries(project.docs)), ...entries(repo.ungrouped)]),
  );
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function nextDocPath(order: readonly NavEntry[], current: string | null, step: 1 | -1): string | null {
  const visible = (entry: NavEntry | undefined) => entry !== undefined && !entry.archived;
  const start = current ? order.findIndex((entry) => entry.path === current) : -1;
  if (start === -1) {
    const candidates = order.filter(visible);
    return (step === 1 ? candidates[0] : candidates.at(-1))?.path ?? null;
  }
  for (let position = start + step; position >= 0 && position < order.length; position += step) {
    if (visible(order[position])) return order[position]?.path ?? null;
  }
  return current;
}

export function useKeyboardNav(index: DocsIndex | undefined, currentDocPath: string | null): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!index) return;
    const order = sidebarOrder(index);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const step = event.key === "j" ? 1 : event.key === "k" ? -1 : null;
      if (!step) return;
      const target = nextDocPath(order, currentDocPath, step);
      if (target && target !== currentDocPath) {
        event.preventDefault();
        navigate(docHref(target));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, currentDocPath, navigate]);
}
