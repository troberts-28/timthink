import type { DocsIndex, IndexedDoc, ProjectIndex, RepoIndex } from "@timthink/server";
import { Archive, ChevronRight, Eye, EyeOff, Folder, Inbox, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router";
import { useInbox } from "../api/queries";
import { isArchived, partitionArchived } from "../lib/archive";
import { compactDate, pluralise } from "../lib/format";
import { useLocalNameSet } from "../lib/localSetting";
import { repoSections } from "../lib/repoGroups";
import { useRepoVisibility } from "../lib/repoVisibility";
import { docHref, projectHref, repoHref } from "../lib/routes";
import { usePlanArchive } from "../plan/usePlanArchive";
import { AttentionCount } from "./AttentionCount";
import { StatusDot } from "./StatusChip";

const UNGROUPED_PREVIEW = 8;
const PROJECT_PREVIEW = 12;
const COLLAPSED_GROUPS_KEY = "timthink-collapsed-groups";
const REPO_ARCHIVE_INDENT = 23;
const PROJECT_ARCHIVE_INDENT = 41;

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

const ROW_ACTION_HIDES = "transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0";
const PLAN_ACTION_HIDES =
  "transition-opacity duration-150 group-hover/plan:opacity-0 group-focus-within/plan:opacity-0";
const ROW_ACTION_SHOWS = "group-hover:opacity-100 group-focus-within:opacity-100";
const PLAN_ACTION_SHOWS = "group-hover/plan:opacity-100 group-focus-within/plan:opacity-100";

function RowAction({
  label,
  onClick,
  disabled = false,
  reveal,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  reveal: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-[6px] text-ink-32 opacity-0 transition-opacity duration-150 hover:bg-line-soft hover:text-ink focus-visible:opacity-100 disabled:opacity-50 ${reveal}`}
    >
      {children}
    </button>
  );
}

function PlanCount({ count, muted }: { count: number; muted: boolean }) {
  return (
    <span
      className={`ml-auto flex-none pl-2 text-meta tabular-nums ${muted ? "text-ink-32" : "text-ink-64"}`}
      title={pluralise(count, "active plan")}
    >
      {count}
    </span>
  );
}

function PlanRow({ doc, active, indent }: { doc: IndexedDoc; active: boolean; indent: number }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const dimmed = isArchived(doc) && !active;
  const plan = usePlanArchive(doc.path);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div className="group/plan relative">
      <Link
        ref={ref}
        to={docHref(doc.path)}
        aria-current={active ? "page" : undefined}
        title={doc.title}
        className={`relative flex h-8 items-center gap-2.5 rounded-[8px] pr-2.5 text-ui transition-colors duration-150 ${
          active
            ? "bg-surface font-medium text-ink"
            : dimmed
              ? "text-ink-32 hover:bg-surface/60 hover:text-ink-64"
              : "text-ink-64 hover:bg-surface/60 hover:text-ink"
        }`}
        style={{ paddingLeft: indent }}
      >
        {active ? (
          <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent" aria-hidden />
        ) : null}
        <StatusDot status={doc.status} className={dimmed ? "opacity-50" : ""} />
        <span className="min-w-0 flex-1 truncate">{doc.title}</span>
        <span className={`flex-none text-meta text-ink-32 tabular-nums ${PLAN_ACTION_HIDES}`}>
          {compactDate(doc.date)}
        </span>
      </Link>
      <RowAction
        label={plan.archived ? "Restore plan" : "Archive plan"}
        onClick={plan.archived ? plan.restorePlan : plan.archivePlan}
        disabled={plan.pending}
        reveal={PLAN_ACTION_SHOWS}
      >
        {plan.archived ? (
          <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden />
        ) : (
          <Archive className="size-3.5" strokeWidth={1.75} aria-hidden />
        )}
      </RowAction>
    </div>
  );
}

function DocRows({
  docs,
  selection,
  indent,
  preview,
}: {
  docs: IndexedDoc[];
  selection: SidebarSelection;
  indent: number;
  preview: number;
}) {
  const activeIndex = docs.findIndex((doc) => doc.path === selection.docPath);
  const [showAll, setShowAll] = useState(false);
  const limit = Math.max(preview, activeIndex + 1);
  const visible = showAll ? docs : docs.slice(0, limit);
  const hidden = docs.length - visible.length;
  return (
    <div className="flex flex-col gap-px py-0.5">
      {visible.map((doc) => (
        <PlanRow key={doc.path} doc={doc} active={doc.path === selection.docPath} indent={indent} />
      ))}
      {hidden > 0 || (showAll && docs.length > limit) ? (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          className="h-7 rounded-[8px] text-left text-meta font-medium text-ink-64 hover:bg-surface/60 hover:text-ink"
          style={{ paddingLeft: indent + 18 }}
        >
          {showAll ? "Show fewer" : `Show ${hidden} more`}
        </button>
      ) : null}
    </div>
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
  dimmed?: boolean;
  action?: ReactNode;
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
  dimmed = false,
  action,
}: ToggleRowProps) {
  const labelTone = strong
    ? "font-semibold"
    : dimmed || count === 0
      ? "text-ink-32 group-hover:text-ink-64"
      : "font-medium text-ink-64 group-hover:text-ink";
  return (
    <div
      className={`group relative flex h-8 items-center rounded-[8px] pr-2.5 text-ui transition-colors duration-150 ${
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
      <Link
        to={to}
        onClick={(event) => {
          if (open) event.preventDefault();
          onToggle();
        }}
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch pl-1"
      >
        {icon}
        <span className={`min-w-0 truncate ${labelTone}`}>{label}</span>
        <span className={`ml-auto flex flex-none items-center ${action ? ROW_ACTION_HIDES : ""}`}>
          <PlanCount count={count} muted={dimmed || count === 0} />
          {attention > 0 ? (
            <span title={`${attention} in your inbox`} className="flex-none pl-1.5">
              <AttentionCount count={attention} />
            </span>
          ) : null}
        </span>
      </Link>
      {action}
    </div>
  );
}

function ArchivedSection({
  count,
  indent,
  containsSelection,
  children,
}: {
  count: number;
  indent: number;
  containsSelection: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(containsSelection);
  useEffect(() => {
    if (containsSelection) setOpen(true);
  }, [containsSelection]);
  if (count === 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-2 rounded-[8px] pr-2.5 text-left text-meta font-medium text-ink-32 transition-colors duration-150 hover:bg-surface/60 hover:text-ink-64"
        style={{ paddingLeft: indent }}
      >
        <Chevron open={open} />
        <span className="min-w-0 flex-1 truncate">Archived</span>
      </button>
      {open ? children : null}
    </div>
  );
}

function containsDoc(docs: readonly IndexedDoc[], docPath: string | null): boolean {
  return docPath !== null && docs.some((doc) => doc.path === docPath);
}

function ProjectNode({
  repo,
  project,
  selection,
  insideArchive = false,
}: {
  repo: string;
  project: ProjectIndex;
  selection: SidebarSelection;
  insideArchive?: boolean;
}) {
  const containsActive = containsDoc(project.docs, selection.docPath);
  const isActive = selection.repo === repo && selection.project === project.name && !selection.docPath;
  const [open, setOpen] = useState(containsActive || !insideArchive);
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);
  const { active, archived } = partitionArchived(project.docs);
  const listed = insideArchive ? project.docs : active;
  const docIndent = 46;
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
        count={insideArchive ? archived.length : active.length}
        dimmed={insideArchive}
      />
      {open ? (
        <div className="pb-0.5">
          {listed.length > 0 ? (
            <DocRows docs={listed} selection={selection} indent={docIndent} preview={PROJECT_PREVIEW} />
          ) : null}
          {project.docs.length === 0 ? (
            <p className="m-0 py-1 text-meta text-ink-32" style={{ paddingLeft: docIndent }}>
              Files only, no plans
            </p>
          ) : null}
          {insideArchive ? null : (
            <ArchivedSection
              count={archived.length}
              indent={PROJECT_ARCHIVE_INDENT}
              containsSelection={containsDoc(archived, selection.docPath)}
            >
              <DocRows docs={archived} selection={selection} indent={docIndent} preview={PROJECT_PREVIEW} />
            </ArchivedSection>
          )}
        </div>
      ) : null}
    </div>
  );
}

function newestFirst(a: IndexedDoc, b: IndexedDoc): number {
  return b.date.localeCompare(a.date) || b.mtime - a.mtime;
}

function splitProjects(projects: readonly ProjectIndex[]): { live: ProjectIndex[]; settled: ProjectIndex[] } {
  const live: ProjectIndex[] = [];
  const settled: ProjectIndex[] = [];
  for (const project of projects) {
    const allArchived = project.docs.length > 0 && project.docs.every(isArchived);
    (allArchived ? settled : live).push(project);
  }
  return { live, settled };
}

function RepoNode({ repo, selection, attention }: { repo: RepoIndex; selection: SidebarSelection; attention: number }) {
  const containsSelection = selection.repo === repo.name;
  const [open, setOpen] = useState(containsSelection);
  useEffect(() => {
    if (containsSelection) setOpen(true);
  }, [containsSelection]);
  const setVisibility = useRepoVisibility();
  const isActive = containsSelection && !selection.project && !selection.docPath;
  const projectsWithPlans = repo.projects.filter(
    (project) => project.docs.length > 1 || selection.project === project.name,
  );
  const loosePlans = [
    ...repo.ungrouped,
    ...repo.projects
      .filter((project) => project.docs.length === 1 && selection.project !== project.name)
      .flatMap((project) => project.docs),
  ].sort(newestFirst);
  const { live, settled } = splitProjects(projectsWithPlans);
  const ungrouped = partitionArchived(loosePlans);
  const archivedHere = settled.reduce((sum, project) => sum + project.docs.length, ungrouped.archived.length);
  const archivedSelected =
    containsDoc(ungrouped.archived, selection.docPath) ||
    settled.some((project) => containsDoc(project.docs, selection.docPath) || selection.project === project.name);
  const archivedCount = repo.archivedCount ?? 0;
  return (
    <div>
      <ToggleRow
        open={open}
        onToggle={() => setOpen((current) => !current)}
        to={repoHref(repo.name)}
        active={isActive}
        indent={10}
        label={repo.name}
        count={repo.docCount - archivedCount}
        attention={attention}
        strong
        action={
          <RowAction
            label={`Hide ${repo.name}`}
            onClick={() => setVisibility(repo.name, true)}
            reveal={ROW_ACTION_SHOWS}
          >
            <EyeOff className="size-3.5" strokeWidth={1.75} aria-hidden />
          </RowAction>
        }
      />
      {open ? (
        <div className="pb-1.5">
          {live.map((project) => (
            <ProjectNode key={project.name} repo={repo.name} project={project} selection={selection} />
          ))}
          <DocRows docs={ungrouped.active} selection={selection} indent={26} preview={UNGROUPED_PREVIEW} />
          <ArchivedSection count={archivedHere} indent={REPO_ARCHIVE_INDENT} containsSelection={archivedSelected}>
            {settled.map((project) => (
              <ProjectNode key={project.name} repo={repo.name} project={project} selection={selection} insideArchive />
            ))}
            <DocRows docs={ungrouped.archived} selection={selection} indent={26} preview={UNGROUPED_PREVIEW} />
          </ArchivedSection>
        </div>
      ) : null}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase leading-4 tracking-[0.06em] text-ink-32">{children}</span>
  );
}

function GroupSection({
  name,
  collapsed,
  onToggle,
  children,
}: {
  name: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={name} className="mb-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="group mb-1 flex h-6 w-full items-center gap-1.5 rounded-[6px] px-2.5 text-left hover:bg-surface/60"
      >
        <SectionLabel>{name}</SectionLabel>
        <ChevronRight
          className={`size-3 flex-none text-ink-32 opacity-0 transition-[transform,opacity] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${
            collapsed ? "opacity-100" : "rotate-90"
          }`}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      {collapsed ? null : <div className="flex flex-col gap-0.5">{children}</div>}
    </section>
  );
}

function SidebarQuote({ quotes }: { quotes: readonly string[] }) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * quotes.length));
  const quote = quotes[index % quotes.length];
  const next = () =>
    setIndex((current) => (current + 1 + Math.floor(Math.random() * (quotes.length - 1))) % quotes.length);
  return (
    <div className="flex-none border-t border-line-soft px-3 py-2.5">
      <button
        type="button"
        onClick={next}
        title="Another one"
        className="w-full rounded-[8px] px-2.5 py-1.5 text-left text-meta leading-[18px] text-ink-64 italic transition-colors duration-150 hover:bg-surface/60 hover:text-ink"
      >
        “{quote}”
      </button>
    </div>
  );
}

function HiddenRepos({ repos }: { repos: readonly RepoIndex[] }) {
  const [open, setOpen] = useState(false);
  const setVisibility = useRepoVisibility();
  if (repos.length === 0) return null;
  return (
    <section aria-label="Hidden repos" className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-meta font-medium text-ink-32 transition-colors duration-150 hover:bg-surface/60 hover:text-ink-64"
      >
        <Chevron open={open} />
        <span className="min-w-0 flex-1 truncate">Hidden repos</span>
      </button>
      {open
        ? repos.map((repo) => (
            <div
              key={repo.name}
              className="group relative flex h-8 items-center rounded-[8px] pr-9 pl-9 text-ui text-ink-32 transition-colors duration-150 hover:bg-surface/60"
            >
              <Link to={repoHref(repo.name)} className="min-w-0 flex-1 truncate hover:text-ink-64">
                {repo.name}
              </Link>
              <RowAction
                label={`Show ${repo.name}`}
                onClick={() => setVisibility(repo.name, false)}
                reveal={ROW_ACTION_SHOWS}
              >
                <Eye className="size-3.5" strokeWidth={1.75} aria-hidden />
              </RowAction>
            </div>
          ))
        : null}
    </section>
  );
}

function RepoTree({ index, selection }: { index: DocsIndex; selection: SidebarSelection }) {
  const { data: inbox } = useInbox();
  const [collapsedGroups, setGroupCollapsed] = useLocalNameSet(COLLAPSED_GROUPS_KEY);
  const sections = repoSections(index);
  const repoNodes = (repos: RepoIndex[]) =>
    repos
      .filter((repo) => (repo.docCount > 0 && !repo.hidden) || selection.repo === repo.name)
      .map((repo) => (
        <RepoNode
          key={repo.name}
          repo={repo}
          selection={selection}
          attention={inbox?.attention.byRepo[repo.name] ?? 0}
        />
      ));
  return (
    <>
      {sections.map(({ name, repos }) =>
        name === null ? (
          <section key="repos" aria-label="Repos">
            <p className="m-0 mb-1.5 px-2.5">
              <SectionLabel>Repos</SectionLabel>
            </p>
            <div className="flex flex-col gap-0.5">{repoNodes(repos)}</div>
          </section>
        ) : (
          <GroupSection
            key={name}
            name={name}
            collapsed={collapsedGroups.has(name)}
            onToggle={() => setGroupCollapsed(name, !collapsedGroups.has(name))}
          >
            {repoNodes(repos)}
          </GroupSection>
        ),
      )}
      <HiddenRepos repos={index.repos.filter((repo) => repo.hidden && selection.repo !== repo.name)} />
    </>
  );
}

export function Sidebar({ index, selection }: { index: DocsIndex | undefined; selection: SidebarSelection }) {
  const { data: inbox } = useInbox();
  return (
    <div className="flex h-full flex-col bg-bg-sunken">
      <nav aria-label="Plans" className="scroll-quiet scroll-stable min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-6">
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
          <AttentionCount count={inbox?.attention.total ?? 0} className="ml-auto" />
        </NavLink>
        {index ? (
          <RepoTree index={index} selection={selection} />
        ) : (
          <div className="flex flex-col gap-2 px-2.5 pt-1" aria-hidden>
            {[72, 56, 64, 48].map((width) => (
              <div key={width} className="h-3 animate-pulse rounded-full bg-line-soft" style={{ width: `${width}%` }} />
            ))}
          </div>
        )}
      </nav>
      {index && index.sidebarQuotes.length > 0 ? <SidebarQuote quotes={index.sidebarQuotes} /> : null}
    </div>
  );
}
