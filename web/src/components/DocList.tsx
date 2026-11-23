import type { DocSummary } from "@timthink/server";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { archiveOf, isArchived } from "../lib/archive";
import { compactDate, longDate } from "../lib/format";
import { docHref } from "../lib/routes";
import { StatusChip, StatusDot } from "./StatusChip";
import { TaskCount } from "./TaskProgress";

interface DocListProps {
  docs: DocSummary[];
  showLocation?: boolean;
  actionsFor?: (doc: DocSummary) => ReactNode;
}

function location(doc: DocSummary): string {
  if (doc.projectId) {
    return doc.projectId.replace("/", " / ");
  }
  return doc.project && doc.project !== doc.repo ? `${doc.repo} / ${doc.project}` : doc.repo;
}

interface DocRowProps {
  doc: DocSummary;
  showLocation?: boolean;
  actions?: ReactNode;
}

export function DocRow({ doc, showLocation = false, actions }: DocRowProps) {
  const archived = isArchived(doc);
  const reason = archived ? archiveOf(doc).reason : undefined;
  return (
    <li className="group/doc relative border-b border-line-soft last:border-b-0">
      <Link
        to={docHref(doc.path)}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 px-5 py-3.5 transition-colors duration-150 hover:bg-bg/60 sm:grid-cols-[minmax(0,1fr)_auto_auto_64px]"
      >
        <span className="flex min-w-0 items-start gap-3">
          <StatusDot status={doc.status} className={`mt-1.5 ${archived ? "opacity-50" : ""}`} />
          <span className="min-w-0">
            <span
              className={`block truncate text-ui font-medium ${archived ? "text-ink-64" : "text-ink"} group-hover:text-ink`}
            >
              {doc.title}
            </span>
            <span className="mt-0.5 block truncate text-meta text-ink-64">
              {showLocation ? <span className="text-ink-64">{location(doc)} · </span> : null}
              {reason ? <span className="text-ink-64">{reason} · </span> : null}
              <span className="font-mono text-[11.5px] text-ink-32">{doc.relPath}</span>
            </span>
          </span>
        </span>
        <span className="hidden sm:block">
          <StatusChip status={doc.status} />
        </span>
        <span className="hidden sm:block">
          <TaskCount tasks={doc.tasks} />
        </span>
        <time dateTime={doc.date} title={longDate(doc.date)} className="text-right text-meta text-ink-64 tabular-nums">
          {compactDate(doc.date)}
        </time>
      </Link>
      {actions ? (
        <span className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-0.5 rounded-button bg-surface p-0.5 opacity-0 shadow-pop transition-opacity duration-150 group-hover/doc:opacity-100 group-focus-within/doc:opacity-100">
          {actions}
        </span>
      ) : null}
    </li>
  );
}

export function DocList({ docs, showLocation = false, actionsFor }: DocListProps) {
  return (
    <ul className="m-0 list-none overflow-hidden rounded-card border border-line bg-surface p-0">
      {docs.map((doc) => (
        <DocRow key={doc.path} doc={doc} showLocation={showLocation} actions={actionsFor?.(doc)} />
      ))}
    </ul>
  );
}
