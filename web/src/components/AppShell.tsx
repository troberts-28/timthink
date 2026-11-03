import { useCallback, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { useDocsIndex, useLiveUpdates } from "../api/queries";
import { parentHref } from "../lib/navigation";
import { useSelection } from "../lib/selection";
import { useCommandKShortcut, useKeyShortcut } from "../lib/shortcuts";
import { useSidebarCollapsed, useSidebarShortcut } from "../lib/sidebar";
import { useKeyboardNav } from "../lib/useKeyboardNav";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell() {
  useLiveUpdates();
  useSidebarShortcut();
  const navigate = useNavigate();
  const { data: index } = useDocsIndex();
  const selection = useSelection();
  const [sidebarCollapsed] = useSidebarCollapsed();
  useKeyboardNav(index, selection.docPath);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const showShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const hideShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  useKeyShortcut("?", showShortcuts);
  useCommandKShortcut(() => setPaletteOpen((current) => !current));
  useKeyShortcut("i", () => navigate("/"));
  useKeyShortcut("u", () => {
    const parent = parentHref(index, selection);
    if (parent) navigate(parent);
  });
  return (
    <div
      className={`grid h-screen grid-rows-[48px_minmax(0,1fr)] bg-bg transition-[grid-template-columns] duration-200 ease-in-out motion-reduce:transition-none ${
        sidebarCollapsed ? "grid-cols-[0px_minmax(0,1fr)]" : "grid-cols-[272px_minmax(0,1fr)]"
      }`}
    >
      <TopBar index={index} onShowShortcuts={showShortcuts} />
      <aside
        className={`min-h-0 overflow-hidden border-line-soft ${sidebarCollapsed ? "invisible" : "border-r"}`}
        aria-hidden={sidebarCollapsed}
      >
        <div className="h-full w-[272px]">
          <Sidebar index={index} selection={selection} />
        </div>
      </aside>
      <main id="main" className="scroll-quiet scroll-stable min-h-0 overflow-y-auto">
        <Outlet />
      </main>
      <ShortcutsDialog open={shortcutsOpen} onClose={hideShortcuts} />
      <CommandPalette open={paletteOpen} onClose={closePalette} index={index} />
    </div>
  );
}
