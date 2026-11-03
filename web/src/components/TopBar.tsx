import type { DocsIndex } from "@timthink/server";
import { Inbox, Keyboard, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Fragment } from "react";
import { Link, NavLink } from "react-router";
import { useInbox } from "../api/queries";
import { findDoc } from "../lib/indexNav";
import { projectHref, repoHref } from "../lib/routes";
import { useSelection } from "../lib/selection";
import { useSidebarCollapsed } from "../lib/sidebar";
import { AttentionCount } from "./AttentionCount";
import { ThemeToggle } from "./ThemeToggle";
import { TOP_BAR_SLOT_ID } from "./TopBarSlot";

interface Crumb {
  label: string;
  to?: string;
}

function useCrumbs(index: DocsIndex | undefined): Crumb[] {
  const selection = useSelection();
  if (!selection.repo) return [{ label: "Inbox" }];
  const crumbs: Crumb[] = [{ label: selection.repo, to: repoHref(selection.repo) }];
  if (selection.docPath) {
    const doc = findDoc(index, selection.docPath);
    if (doc?.project && doc.project !== selection.repo)
      crumbs.push({ label: doc.project, to: projectHref(selection.repo, doc.project) });
    crumbs.push({ label: doc?.title ?? selection.docPath.split("/").pop() ?? "" });
  } else if (selection.project) {
    crumbs.push({ label: selection.project });
  }
  return crumbs;
}

function InboxLink() {
  const { data: inbox } = useInbox();
  const count = inbox?.attention.total ?? 0;
  return (
    <NavLink
      to="/"
      end
      aria-label={count > 0 ? `Inbox, ${count} need${count === 1 ? "s" : ""} you` : "Inbox"}
      className={({ isActive }) =>
        `flex h-8 items-center gap-2 rounded-button border px-3 text-meta font-medium transition-colors duration-150 ${
          isActive ? "border-line bg-surface text-ink" : "border-line-soft text-ink-64 hover:border-line hover:text-ink"
        }`
      }
    >
      <Inbox className="size-3.5" strokeWidth={2} aria-hidden />
      Inbox
      <AttentionCount count={count} />
    </NavLink>
  );
}

function SidebarToggle() {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const label = `${collapsed ? "Show" : "Hide"} sidebar`;
  return (
    <button
      type="button"
      onClick={() => setCollapsed(!collapsed)}
      aria-label={label}
      aria-pressed={!collapsed}
      title={label}
      className="grid size-8 flex-none place-items-center rounded-button text-ink-64 transition-colors duration-150 hover:bg-surface hover:text-ink"
    >
      {collapsed ? (
        <PanelLeftOpen className="size-4" strokeWidth={1.75} aria-hidden />
      ) : (
        <PanelLeftClose className="size-4" strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
}

export function TopBar({ index, onShowShortcuts }: { index: DocsIndex | undefined; onShowShortcuts: () => void }) {
  const crumbs = useCrumbs(index);
  const [sidebarCollapsed] = useSidebarCollapsed();
  return (
    <header
      className={`col-span-2 grid h-12 border-b border-line-soft ${
        sidebarCollapsed ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-[272px_minmax(0,1fr)]"
      }`}
    >
      <div
        className={`flex items-center gap-2.5 border-r border-line-soft bg-bg-sunken ${
          sidebarCollapsed ? "px-2.5" : "justify-between pr-2.5 pl-5"
        }`}
      >
        <Link
          to="/"
          aria-label="timthink inbox"
          className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em] text-ink"
        >
          <span className="grid size-5 place-items-center rounded-[6px] bg-ink" aria-hidden>
            <span className="size-2 rounded-full bg-accent" />
          </span>
          {sidebarCollapsed ? null : "timthink"}
        </Link>
        <SidebarToggle />
      </div>
      <div className="flex min-w-0 items-center gap-4 bg-bg px-6">
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="m-0 flex min-w-0 list-none items-center gap-2 p-0 text-ui">
            {crumbs.map((crumb, position) => {
              const last = position === crumbs.length - 1;
              return (
                <Fragment key={crumb.to ?? crumb.label}>
                  {position > 0 ? (
                    <li aria-hidden className="text-ink-32">
                      /
                    </li>
                  ) : null}
                  <li className={`min-w-0 ${last ? "truncate font-medium text-ink" : "flex-none text-ink-64"}`}>
                    {crumb.to && !last ? (
                      <Link to={crumb.to} className="hover:text-ink">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span aria-current={last ? "page" : undefined}>{crumb.label}</span>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </nav>
        <div id={TOP_BAR_SLOT_ID} className="flex items-center gap-2" />
        <InboxLink />
        <button
          type="button"
          onClick={onShowShortcuts}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          className="grid size-8 flex-none place-items-center rounded-button text-ink-64 transition-colors duration-150 hover:bg-surface hover:text-ink"
        >
          <Keyboard className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
