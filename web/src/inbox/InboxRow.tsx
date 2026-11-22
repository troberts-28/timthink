import type { InboxQuestionItem, InboxRoundItem } from "@timthink/server";
import { ListChecks } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { StatusDot } from "../components/StatusChip";
import { relativeTime } from "../lib/format";
import { docHref, roundHref } from "../lib/routes";
import { InboxQuestion } from "./InboxQuestion";

export function InboxQuestionRow({ item, showRepo }: { item: InboxQuestionItem; showRepo: boolean }) {
  const { repo, project } = item.doc;
  const projectName = project && project !== repo ? project : null;
  const place = showRepo ? [repo, projectName].filter(Boolean).join(" / ") : projectName;
  return (
    <InboxRowFrame
      at={item.at}
      marker={<StatusDot status={item.doc.status} className="mt-1.5" />}
      href={`${docHref(item.doc.path)}#question-${encodeURIComponent(item.questionId)}`}
      title={item.doc.title}
      chip={<span className="chip chip-accent">Unanswered</span>}
      place={place}
    >
      <InboxQuestion question={item.question} doc={item.doc} />
    </InboxRowFrame>
  );
}

export function InboxRoundRow({ item, showRepo }: { item: InboxRoundItem; showRepo: boolean }) {
  const { round } = item;
  const prs = round.prs.map((pr) => `#${pr.number}`).join(", ");
  return (
    <InboxRowFrame
      at={item.at}
      marker={<ListChecks className="mt-0.5 size-4 flex-none text-accent-ink" strokeWidth={1.75} aria-hidden />}
      href={roundHref(round.id)}
      title={round.title}
      chip={
        <span className={`chip ${round.waiting ? "chip-accent" : "chip-neutral"}`}>
          {round.decidedCount} of {round.itemCount} decided
        </span>
      }
      place={[showRepo ? round.repo : null, prs, round.waiting ? "Claude is waiting" : "no session waiting"]
        .filter(Boolean)
        .join(" · ")}
    />
  );
}

interface InboxRowFrameProps {
  at: string;
  marker: ReactNode;
  href: string;
  title: string;
  chip: ReactNode;
  place: string | null;
  children?: ReactNode;
}

function InboxRowFrame({ at, marker, href, title, chip, place, children }: InboxRowFrameProps) {
  return (
    <li className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-6 border-b border-line-soft px-5 py-3.5 transition-colors duration-150 last:border-b-0 hover:bg-bg/60">
      <div className="flex min-w-0 items-start gap-3">
        {marker}
        <div className="min-w-0 flex-1">
          <Link
            to={href}
            className="block truncate text-ui font-medium text-ink after:absolute after:inset-0 after:content-['']"
          >
            {title}
          </Link>
          <p className="m-0 mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-64">
            {chip}
            {place ? <span className="truncate">{place}</span> : null}
          </p>
          {children}
        </div>
      </div>
      <time
        dateTime={at}
        className="relative z-10 min-w-[64px] text-right text-meta whitespace-nowrap text-ink-64 tabular-nums"
      >
        {relativeTime(Date.parse(at))}
      </time>
    </li>
  );
}
