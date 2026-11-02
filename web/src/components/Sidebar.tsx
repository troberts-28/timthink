import type { DocSummary, DocsIndex, ProjectIndex, RepoIndex } from "@timthink/server";
import { ChevronRight, Folder, Inbox } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router";
import { useInbox } from "../api/queries";
import { compactDate } from "../lib/format";
import { docHref, projectHref, repoHref } from "../lib/routes";
import { AttentionCount } from "./AttentionCount";
import { StatusDot } from "./StatusChip";

const UNGROUPED_PREVIEW = 8;

export interface SidebarSelection {
  repo: string | null;
  project: string | null;
  docPath: string | null;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      className={`size-3.5 flex-none text-ink-32 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
      strokeWidth={2}
      aria-hidden
    />
  );
}

function Count({ children }: { children: ReactNode }) {
  return <span className="ml-auto pl-2 text-meta text-ink-32 tabular-nums">{children}</span>;
}

function PlanRow({ doc, active, indent }: { doc: DocSummary; active: boolean; indent: number }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <Link
      ref={ref}
      to={docHref(doc.path)}
      aria-current={active ? "page" : undefined}
      title={doc.title}
      className={`relative flex h-8 items-center gap-2.5 rounded-[8px] pr-2.5 text-ui transition-colors duration-150 ${
        active ? "bg-surface font-medium text-ink" : "text-ink-64 hover:bg-surface/60 hover:text-ink"
      }`}
      style={{ paddingLeft: indent }}
    >
      {active ? (
        <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent" aria-hidden />
      ) : null}
      <StatusDot status={doc.status} />
      <span className="min-w-0 flex-1 truncate">{doc.title}</span>
      <span className="flex-none text-meta text-ink-32 tabular-nums">{compactDate(doc.date)}</span>
    </Link>
  );
}

interface ToggleRowProps {
  open: boolean;
  onToggle: () => void;
  to: string;
  active: boolean;
  indent: number;
  icon?: ReactNode;
  label: string;
  count: number;
  attention?: number;
  strong?: boolean;
}

function ToggleRow({
  open,
  onToggle,
  to,
  active,
  indent,
  icon,
  label,
  count,
  attention = 0,
  strong = false,
}: ToggleRowProps) {
  return (
    <div
      className={`group flex h-8 items-center rounded-[8px] pr-2.5 text-ui transition-colors duration-150 ${
        active ? "bg-surface text-ink" : "text-ink hover:bg-surface/60"
      }`}
      style={{ paddingLeft: indent }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
        className="-ml-1 grid size-6 flex-none place-items-center rounded-[6px] hover:bg-line-soft"
      >
        <Chevron open={open} />
      </button>
      <Link to={to} onClick={() => !open && onToggle()} className="flex min-w-0 flex-1 items-center gap-2 pl-1">
        {icon}
        <span
          className={`truncate ${
            strong ? "font-semibold" : count === 0 ? "text-ink-32" : "font-medium text-ink-64 group-hover:text-ink"
          }`}
        >
          {label}
        </span>
        <Count>{count}</Count>
        {attention > 0 ? (
          <span title={`${attention} in your inbox`} className="flex-none pl-1.5">
            <AttentionCount count={attention} />
          </span>
        ) : null}
      </Link>
    </div>
  );
}

function ProjectNode({
  repo,
  project,
  selection,
}: {
  repo: string;
  project: ProjectIndex;
  selection: SidebarSelection;
}) {
  const containsActive = project.docs.some((doc) => doc.path === selection.docPath);
  const isActive = selection.repo === repo && selection.project === project.name && !selection.docPath;
  const [open, setOpen] = useState(containsActive);
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);
  return (
    <div>
      <ToggleRow
        open={open}
        onToggle={() => setOpen((current) => !current)}
        to={projectHref(repo, project.name)}
        active={isActive}
        indent={22}
        icon={<Folder className="size-3.5 flex-none text-ink-32" strokeWidth={1.75} aria-hidden />}
        label={project.name}
        count={project.docs.length}
      />
      {open ? (
        <div className="flex flex-col gap-px py-0.5">
          {project.docs.map((doc) => (
            <PlanRow key={doc.path} doc={doc} active={doc.path === selection.docPath} indent={46} />
          ))}
          {project.docs.length === 0 ? (
            <p className="m-0 py-1 pl-[46px] text-meta text-ink-32">Files only, no plans</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UngroupedDocs({ docs, selection }: { docs: DocSummary[]; selection: SidebarSelection }) {
  const activeIndex = docs.findIndex((doc) => doc.path === selection.docPath);
  const [showAll, setShowAll] = useState(false);
  const limit = Math.max(UNGROUPED_PREVIEW, activeIndex + 1);
  const visible = showAll ? docs : docs.slice(0, limit);
  const hidden = docs.length - visible.length;
  return (
    <div className="flex flex-col gap-px py-0.5">
      {visible.map((doc) => (
        <PlanRow key={doc.path} doc={doc} active={doc.path === selection.docPath} indent={26} />
      ))}
      {hidden > 0 || showAll ? (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          className="h-7 rounded-[8px] pl-[44px] text-left text-meta font-medium text-ink-64 hover:bg-surface/60 hover:text-ink"
        >
          {showAll ? "Show fewer" : `Show ${hidden} more`}
        </button>
      ) : null}
    </div>
  );
}

function RepoNode({ repo, selection, attention }: { repo: RepoIndex; selection: SidebarSelection; attention: number }) {
  const containsSelection = selection.repo === repo.name;
  const [open, setOpen] = useState(containsSelection);
  useEffect(() => {
    if (containsSelection) setOpen(true);
  }, [containsSelection]);
  const isActive = containsSelection && !selection.project && !selection.docPath;
  return (
    <div>
      <ToggleRow
        open={open}
        onToggle={() => setOpen((current) => !current)}
        to={repoHref(repo.name)}
        active={isActive}
        indent={10}
        label={repo.name}
        count={repo.docCount}
        attention={attention}
        strong
      />
      {open ? (
        <div className="pb-1.5">
          {repo.projects.map((project) => (
            <ProjectNode key={project.name} repo={repo.name} project={project} selection={selection} />
          ))}
          <UngroupedDocs docs={repo.ungrouped} selection={selection} />
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({ index, selection }: { index: DocsIndex | undefined; selection: SidebarSelection }) {
  const { data: inbox } = useInbox();
  const attention = inbox?.attention;
  return (
    <nav aria-label="Plans" className="scroll-quiet flex h-full flex-col overflow-y-auto bg-bg-sunken px-3 pt-3 pb-8">
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `relative mb-4 flex h-8 items-center gap-2.5 rounded-[8px] px-2.5 text-ui font-medium transition-colors duration-150 ${
            isActive ? "bg-surface text-ink" : "text-ink-64 hover:bg-surface/60 hover:text-ink"
          }`
        }
      >
        <Inbox className="size-4 text-ink-32" strokeWidth={1.75} aria-hidden />
        Inbox
        <AttentionCount count={attention?.total ?? 0} className="ml-auto" />
      </NavLink>
      <p className="m-0 mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-32">Repos</p>
      {index ? (
        <div className="flex flex-col gap-0.5">
          {index.repos.map((repo) => (
            <RepoNode key={repo.name} repo={repo} selection={selection} attention={attention?.byRepo[repo.name] ?? 0} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-2.5 pt-1" aria-hidden>
          {[72, 56, 64, 48].map((width) => (
            <div key={width} className="h-3 animate-pulse rounded-full bg-line-soft" style={{ width: `${width}%` }} />
          ))}
        </div>
      )}
    </nav>
  );
}
