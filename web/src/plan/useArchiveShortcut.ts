import { useEffect } from "react";
import { isTypingTarget } from "../lib/useKeyboardNav";
import type { PlanArchive } from "./usePlanArchive";

export function useArchiveShortcut({ archived, pending, archivePlan, restorePlan }: PlanArchive): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "e" || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (isTypingTarget(event.target) || pending) return;
      event.preventDefault();
      if (archived) restorePlan();
      else archivePlan();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [archived, pending, archivePlan, restorePlan]);
}
