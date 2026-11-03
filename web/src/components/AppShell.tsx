import { Outlet } from "react-router";
import { useDocsIndex, useLiveUpdates } from "../api/queries";
import { useSelection } from "../lib/selection";
import { useSidebarCollapsed, useSidebarShortcut } from "../lib/sidebar";
import { useKeyboardNav } from "../lib/useKeyboardNav";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell() {
  useLiveUpdates();
  useSidebarShortcut();
  const { data: index } = useDocsIndex();
  const selection = useSelection();
  const [sidebarCollapsed] = useSidebarCollapsed();
  useKeyboardNav(index, selection.docPath);
  return (
    <div
      className={`grid h-screen grid-rows-[48px_minmax(0,1fr)] bg-bg transition-[grid-template-columns] duration-200 ease-in-out motion-reduce:transition-none ${
        sidebarCollapsed ? "grid-cols-[0px_minmax(0,1fr)]" : "grid-cols-[272px_minmax(0,1fr)]"
      }`}
    >
      <TopBar index={index} />
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
    </div>
  );
}
