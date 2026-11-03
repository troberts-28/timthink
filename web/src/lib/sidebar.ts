import { useEffect } from "react";
import { useLocalFlag } from "./localSetting";
import { isTypingTarget } from "./useKeyboardNav";

const SIDEBAR_COLLAPSED_KEY = "timthink.sidebarCollapsed";
export const SIDEBAR_TOGGLE_KEY = "[";

export function useSidebarCollapsed(): [boolean, (collapsed: boolean) => void] {
  return useLocalFlag(SIDEBAR_COLLAPSED_KEY);
}

export function useSidebarShortcut(): void {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== SIDEBAR_TOGGLE_KEY || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setCollapsed(!collapsed);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collapsed, setCollapsed]);
}
