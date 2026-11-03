import { Outlet } from "react-router";
import { useDocsIndex, useLiveUpdates } from "../api/queries";
import { useSelection } from "../lib/selection";
import { useKeyboardNav } from "../lib/useKeyboardNav";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell() {
  useLiveUpdates();
  const { data: index } = useDocsIndex();
  const selection = useSelection();
  useKeyboardNav(index, selection.docPath);
  return (
    <div className="grid h-screen grid-cols-[272px_minmax(0,1fr)] grid-rows-[48px_minmax(0,1fr)] bg-bg">
      <TopBar index={index} />
      <aside className="min-h-0 border-r border-line-soft">
        <Sidebar index={index} selection={selection} />
      </aside>
      <main id="main" className="scroll-quiet scroll-stable min-h-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
