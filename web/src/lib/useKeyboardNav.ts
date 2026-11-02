import type { DocsIndex } from "@timthink/server";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { docHref } from "./routes";

export function sidebarOrder(index: DocsIndex): string[] {
  return index.repos.flatMap((repo) => [
    ...repo.projects.flatMap((project) => project.docs.map((doc) => doc.path)),
    ...repo.ungrouped.map((doc) => doc.path),
  ]);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function nextDocPath(order: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (order.length === 0) return null;
  const index = current ? order.indexOf(current) : -1;
  if (index === -1) return step === 1 ? (order[0] ?? null) : (order[order.length - 1] ?? null);
  return order[Math.min(order.length - 1, Math.max(0, index + step))] ?? null;
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
