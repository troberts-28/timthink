import { useQueryClient } from "@tanstack/react-query";
import type {
  LooksFinishedDoc,
  ProjectActivity,
  ProjectDetail,
  ProjectQuestion,
  ProjectThread,
  RoundSummary,
  SessionView,
} from "@timthink/server";
import { blockIdOf, isPageFile } from "@timthink/server/shared";
import { ChevronRight, CircleCheck, CircleHelp, FolderKanban, ListChecks, MessageSquare } from "lucide-react";
import { useId, useState } from "react";
import { Link, useParams } from "react-router";
import { NotFoundError } from "../api/client";
import { settlePlanCompletion } from "../api/projects";
import { queryKeys, useProject } from "../api/queries";
import { ArchivedDocs } from "../components/ArchivedDocs";
import { AttachmentList } from "../components/AttachmentList";
import { Button } from "../components/Button";
import { DocsByKind } from "../components/DocsByKind";
import { EmptyState } from "../components/EmptyState";
import { PageContainer, PageHeader, SectionHeading } from "../components/PageHeader";
import { PlanRowActions } from "../components/PlanRowActions";
import { partitionArchived } from "../lib/archive";
import { pluralise, relativeTime } from "../lib/format";
import { areaHref, docHref, roundHref } from "../lib/routes";
import { useToast } from "../lib/toast";
import { ProjectAuthoredPage } from "../page/AuthoredPage";
import { SessionRow } from "../plan/SessionsPanel";
import { ProjectActions } from "./ProjectActions";
import { ProjectPrs } from "./ProjectPrs";
import { PublishedPages } from "./ProjectPublishing";
import { ProjectStatusPicker } from "./ProjectStatus";

export function ProjectPage() {
  const { "*": projectId = "" } = useParams();
  const { data: detail, error, isLoading } = useProject(projectId);
  if (error) {
    return (
      <PageContainer>
        <EmptyState icon={FolderKanban}>
          {error instanceof NotFoundError ? "There is no project with that id." : "This project couldn't be loaded."}
        </EmptyState>
      </PageContainer>
    );
  }
  if (isLoading || !detail) {
    return <PageContainer>{null}</PageContainer>;
  }
  return <ProjectOverview detail={detail} />;
}

function ProjectOverview({ detail }: { detail: ProjectDetail }) {
  const { project } = detail;
  const { active, archived } = partitionArchived(project.docs);
  const yourQuestions = detail.questions.filter((question) => !question.answered);
  const yourThreads = detail.threads.filter((thread) => thread.waitingOn === "you");
  const claudeThreads = detail.threads.filter((thread) => thread.waitingOn === "claude");
  const answeredQuestions = detail.questions.filter((question) => question.answered);
  return (
    <PageContainer>
      <ProjectActions project={project} />
      <PageHeader
        eyebrow={
          detail.area ? (
            <Link to={areaHref(detail.area.id)} className="hover:text-ink">
              {detail.area.title}
            </Link>
          ) : (
            "Project"
          )
        }
        title={project.title}
        meta={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ProjectStatusPicker projectId={project.id} status={project.status} />
            {project.repos.length > 0 ? <span>{project.repos.join(", ")}</span> : null}
            <span>· {pluralise(active.length, "active doc")}</span>
          </span>
        }
      />
      {project.summary ? (
        <p className="m-0 -mt-4 mb-8 max-w-[72ch] text-[16px] leading-[1.6] text-ink-64">{project.summary}</p>
      ) : null}
      {project.problems.length > 0 ? <ManifestProblems problems={project.problems} /> : null}
      <ProjectAuthoredPage detail={detail} />
      {yourQuestions.length + yourThreads.length > 0 ? (
        <section className="mb-10">
          <SectionHeading aside={pluralise(yourQuestions.length + yourThreads.length, "item")}>
            Needs you
          </SectionHeading>
          <ul className="m-0 list-none overflow-hidden rounded-card border border-line bg-surface p-0">
            {yourQuestions.map((question) => (
              <QuestionRow key={`${question.docPath}:${question.line}`} question={question} />
            ))}
            {yourThreads.map((thread) => (
              <ThreadRow key={thread.threadId} thread={thread} />
            ))}
          </ul>
        </section>
      ) : null}
      {detail.looksFinished.length > 0 ? (
        <section className="mb-10">
          <SectionHeading aside={pluralise(detail.looksFinished.length, "plan")}>Looks finished</SectionHeading>
          <ul className="m-0 list-none overflow-hidden rounded-card border border-line bg-surface p-0">
            {detail.looksFinished.map((plan) => (
              <LooksFinishedRow key={plan.docPath} projectId={project.id} plan={plan} />
            ))}
          </ul>
        </section>
      ) : null}
      <section className="mb-10">
        <SectionHeading>Pull requests</SectionHeading>
        <ProjectPrs
          projectId={project.id}
          prs={detail.prs}
          repoLinks={detail.repoLinks}
          showRepo={project.repos.length > 1}
        />
      </section>
      <PublishedPages projectId={project.id} />
      {detail.rounds.length > 0 ? (
        <section className="mb-10">
          <SectionHeading aside={pluralise(detail.rounds.length, "round")}>Rounds</SectionHeading>
          <ul className="m-0 list-none overflow-hidden rounded-card border border-line bg-surface p-0">
            {detail.rounds.map((round) => (
              <RoundRow key={round.id} round={round} />
            ))}
          </ul>
        </section>
      ) : null}
      <DocsByKind docs={active} />
      {active.length === 0 ? (
        <div className="mb-10 rounded-card border border-line bg-surface">
          <EmptyState>
            {archived.length > 0 ? "Every doc here is archived." : "No docs yet. Write one into this project's folder."}
          </EmptyState>
        </div>
      ) : null}
      <ArchivedDocs docs={archived} actionsFor={(doc) => <PlanRowActions doc={doc} />} />
      {claudeThreads.length + answeredQuestions.length > 0 ? (
        <section className="mb-10">
          <SectionHeading>Waiting on Claude</SectionHeading>
          <ul className="m-0 list-none overflow-hidden rounded-card border border-line bg-surface p-0">
            {answeredQuestions.map((question) => (
              <QuestionRow key={`${question.docPath}:${question.line}`} question={question} />
            ))}
            {claudeThreads.map((thread) => (
              <ThreadRow key={thread.threadId} thread={thread} />
            ))}
          </ul>
        </section>
      ) : null}
      <ProjectSessions sessions={detail.sessions} />
      {detail.activity.length > 0 ? (
        <section className="mb-10">
          <SectionHeading>Activity</SectionHeading>
          <ol className="m-0 list-none p-0">
            {detail.activity.map((entry) => (
              <ActivityRow key={`${entry.kind}:${entry.at}:${entry.docPath ?? entry.pr?.number}`} entry={entry} />
            ))}
          </ol>
        </section>
      ) : null}
      {detail.attachments.length > 0 ? (
        <section>
          <SectionHeading aside={pluralise(detail.attachments.length, "file")}>Files</SectionHeading>
          <div className="rounded-card border border-line bg-surface px-2 py-1.5">
            <AttachmentList attachments={detail.attachments} stripPrefix={`${project.id}/`} />
          </div>
        </section>
      ) : null}
    </PageContainer>
  );
}

function ProjectSessions({ sessions }: { sessions: SessionView[] }) {
  const [showEarlier, setShowEarlier] = useState(false);
  const earlierId = useId();
  if (sessions.length === 0) {
    return null;
  }
  const live = sessions.filter((session) => session.live);
  const earlier = sessions.filter((session) => !session.live);
  return (
    <section className="mb-10">
      <SectionHeading aside={pluralise(live.length, "live session")}>Sessions</SectionHeading>
      {live.length > 0 ? (
        <ul className="m-0 mb-3 list-none divide-y divide-line-soft overflow-hidden rounded-card border border-line bg-surface p-0">
          {live.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </ul>
      ) : null}
      {earlier.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setShowEarlier((current) => !current)}
            aria-expanded={showEarlier}
            aria-controls={earlierId}
            className="mb-3 flex items-center gap-1.5 rounded-[6px] text-[12px] font-semibold uppercase leading-4 tracking-[0.06em] text-ink-32 hover:text-ink-64"
          >
            <ChevronRight
              className={`size-3.5 transition-transform duration-150 ${showEarlier ? "rotate-90" : ""}`}
              strokeWidth={2}
              aria-hidden
            />
            Earlier
          </button>
          {showEarlier ? (
            <ul
              id={earlierId}
              className="m-0 list-none divide-y divide-line-soft overflow-hidden rounded-card border border-line bg-surface p-0"
            >
              {earlier.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function ManifestProblems({ problems }: { problems: string[] }) {
  return (
    <div className="mb-8 rounded-card border border-line bg-bad-soft px-4 py-3 text-ui text-ink">
      <p className="m-0 font-medium">project.yaml has problems, so some fields fell back to defaults:</p>
      <ul className="m-0 mt-1 pl-5">
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </div>
  );
}

function QuestionRow({ question }: { question: ProjectQuestion }) {
  return (
    <li className="border-b border-line-soft last:border-b-0">
      <Link
        to={docHref(question.docPath)}
        className="flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-bg/60"
      >
        <CircleHelp className="mt-0.5 size-4 flex-none text-accent-ink" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0">
          <span className="block text-ui font-medium text-ink">{question.prompt}</span>
          <span className="block truncate text-meta text-ink-64">
            {question.answered ? "Answered, waiting for Claude · " : "Open question · "}
            {question.docTitle}
          </span>
        </span>
      </Link>
    </li>
  );
}

const ROUND_STATE_CHIPS: Record<RoundSummary["state"], { label: string; className: string }> = {
  open: { label: "Waiting on you", className: "chip-accent" },
  submitted: { label: "With Claude", className: "chip-info" },
  done: { label: "Done", className: "chip-ok-soft" },
  abandoned: { label: "Abandoned", className: "chip-muted" },
};

function LooksFinishedRow({ projectId, plan }: { projectId: string; plan: LooksFinishedDoc }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const settle = async (done: boolean) => {
    setBusy(true);
    try {
      await settlePlanCompletion(plan.docPath, done);
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      toast(done ? "Marked it done." : "Kept it open.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't update the plan", "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex items-start gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
      <CircleCheck className="mt-0.5 size-4 flex-none text-ink-32" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1">
        <Link to={docHref(plan.docPath)} className="block truncate text-ui font-medium text-ink hover:underline">
          {plan.title}
        </Link>
        <span className="block truncate text-meta text-ink-64">
          {plan.prs.map((number) => `#${number}`).join(", ")} landed · {pluralise(plan.openTasks, "task")} still open
        </span>
      </span>
      <Button size="sm" tone="ghost" disabled={busy} onClick={() => void settle(false)}>
        Keep open
      </Button>
      <Button size="sm" tone="primary" disabled={busy} onClick={() => void settle(true)}>
        Mark done
      </Button>
    </li>
  );
}

function RoundRow({ round }: { round: RoundSummary }) {
  const chip = ROUND_STATE_CHIPS[round.state];
  const progress =
    round.state === "open"
      ? `${round.decidedCount} of ${round.itemCount} decided`
      : `${round.reportedCount} of ${round.itemCount} reported`;
  return (
    <li className="border-b border-line-soft last:border-b-0">
      <Link
        to={roundHref(round.id)}
        className="flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-bg/60"
      >
        <ListChecks className="mt-0.5 size-4 flex-none text-ink-32" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium text-ink">{round.title}</span>
          <span className="block truncate text-meta text-ink-64">
            {round.prs.map((pr) => `#${pr.number}`).join(", ")} · {progress} ·{" "}
            {relativeTime(Date.parse(round.createdAt))}
          </span>
        </span>
        <span className={`chip ${chip.className} flex-none`}>{chip.label}</span>
      </Link>
    </li>
  );
}

function ThreadRow({ thread }: { thread: ProjectThread }) {
  const rowClass = "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-bg/60";
  const content = (
    <>
      <MessageSquare className="mt-0.5 size-4 flex-none text-ink-32" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-ui text-ink">{thread.body || thread.quote}</span>
        <span className="block truncate text-meta text-ink-64">
          {thread.waitingOn === "you" ? "Claude replied · " : "Your comment · "}
          {thread.docTitle} · “{blockIdOf(thread.quote) ?? thread.quote}”
        </span>
      </span>
    </>
  );
  return (
    <li className="border-b border-line-soft last:border-b-0">
      {isPageFile(thread.docPath) ? (
        <button type="button" className={rowClass} onClick={() => scrollToThreadCard(thread.threadId)}>
          {content}
        </button>
      ) : (
        <Link to={docHref(thread.docPath)} className={rowClass}>
          {content}
        </Link>
      )}
    </li>
  );
}

function scrollToThreadCard(threadId: string) {
  document.querySelector(`[data-thread-id="${threadId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
}

const ACTIVITY_VERBS: Record<ProjectActivity["kind"], string> = {
  "doc-updated": "Updated",
  "review-submitted": "You reviewed",
  "review-addressed": "Claude addressed your review of",
  "pr-merged": "Merged",
  "pr-closed": "Closed",
  "pr-updated": "Updated",
};

function ActivityRow({ entry }: { entry: ProjectActivity }) {
  const subject = entry.pr ? `#${entry.pr.number} ${entry.title}` : entry.title;
  return (
    <li className="flex items-baseline gap-3 py-1.5 text-ui">
      <time dateTime={entry.at} className="w-20 flex-none text-meta text-ink-32 tabular-nums">
        {relativeTime(Date.parse(entry.at))}
      </time>
      <span className="min-w-0 truncate text-ink-64">
        {ACTIVITY_VERBS[entry.kind]}{" "}
        {entry.docPath ? (
          <Link to={docHref(entry.docPath)} className="text-ink hover:underline">
            {subject}
          </Link>
        ) : entry.pr ? (
          <a href={entry.pr.url} target="_blank" rel="noreferrer" className="text-ink hover:underline">
            {subject}
          </a>
        ) : (
          <span className="text-ink">{subject}</span>
        )}
      </span>
    </li>
  );
}
