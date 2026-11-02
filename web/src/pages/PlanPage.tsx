import type { DocDetail, DocsIndex, RepoIndex } from "@timthink/server";
import type { Root } from "hast";
import { FileQuestion } from "lucide-react";
import { type ReactNode, useEffect, useMemo } from "react";
import { useLocation, useParams } from "react-router";
import { NotFoundError } from "../api/client";
import { useDoc, useDocsIndex } from "../api/queries";
import { ChangesBanner } from "../changes/ChangesBanner";
import { ChangesProvider, useChanges } from "../changes/ChangesContext";
import { ChangesLayer } from "../changes/ChangesLayer";
import { withRemovedGhosts } from "../changes/ghosts";
import { HistoryMenu } from "../changes/HistoryMenu";
import { AttachmentList } from "../components/AttachmentList";
import { EmptyState } from "../components/EmptyState";
import { ProgressBar } from "../components/TaskProgress";
import { TopBarSlot } from "../components/TopBarSlot";
import { pluralise } from "../lib/format";
import { findRepo } from "../lib/indexNav";
import { MarkdownBody } from "../markdown/Markdown";
import { PlanContext } from "../markdown/PlanContext";
import { ContentsMenu } from "../plan/ContentsMenu";
import { PlanMeta } from "../plan/PlanMeta";
import { SessionsPanel } from "../plan/SessionsPanel";
import { useActiveHeading } from "../plan/useActiveHeading";
import { useRenderedMarkdown } from "../plan/useRenderedMarkdown";
import { ReviewButton, ReviewChip } from "../review/ReviewChip";
import { ReviewProvider } from "../review/ReviewContext";
import { ReviewWorkspace } from "../review/ReviewWorkspace";

const SCROLL_CONTAINER_ID = "main";

function PaperSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="h-9 w-2/3 animate-pulse rounded-button bg-line-soft" />
      <div className="h-4 w-1/3 animate-pulse rounded-full bg-line-soft" />
      <div className="mt-6 flex flex-col gap-3">
        {[92, 84, 88, 60].map((width) => (
          <div key={width} className="h-3.5 animate-pulse rounded-full bg-line-soft" style={{ width: `${width}%` }} />
        ))}
      </div>
    </div>
  );
}

function TaskSummary({ doc }: { doc: DocDetail }) {
  const { tasks } = doc.summary;
  if (tasks.total === 0) return null;
  return (
    <div className="mt-6 flex items-center gap-3">
      <ProgressBar tasks={tasks} className="flex-1" />
      <span className="flex-none text-meta text-ink-64 tabular-nums">
        {tasks.done} of {pluralise(tasks.total, "task")} done
      </span>
    </div>
  );
}

interface PaperProps {
  doc: DocDetail;
  repo: RepoIndex | undefined;
  body: ReactNode;
  bodyRef: (element: HTMLDivElement | null) => void;
  headerActions: ReactNode;
}

function Paper({ doc, repo, body, bodyRef, headerActions }: PaperProps) {
  const stripPrefix = doc.summary.relPath.includes("/") ? `${doc.summary.relPath.split("/")[0]}/` : "";
  return (
    <>
      <ChangesBanner />
      <article className="mx-auto max-w-[760px] rounded-paper border border-line bg-surface px-8 pt-10 pb-14 sm:px-14">
        <header className="mb-10 border-b border-line-soft pb-7">
          <div className="mb-5 flex items-start justify-between gap-4">
            <p className="m-0 truncate pt-1.5 font-mono text-[11.5px] text-ink-32" title={doc.summary.path}>
              {doc.summary.relPath}
            </p>
            <div className="flex flex-none items-center gap-2">
              {headerActions}
              <SessionsPanel docPath={doc.summary.path} />
            </div>
          </div>
          <h1 className="display m-0 text-plan-title text-ink">{doc.summary.title}</h1>
          <div className="mt-4">
            <PlanMeta doc={doc.summary} github={repo?.github ?? null} prLinks={repo?.prLinks ?? "graphite"} />
          </div>
          <ReviewChipRow />
          <TaskSummary doc={doc} />
        </header>
        <div ref={bodyRef}>{body}</div>
        {doc.attachments.length > 0 ? (
          <section className="mt-14 border-t border-line-soft pt-6">
            <h2 className="m-0 mb-2 text-[12px] font-semibold uppercase leading-4 tracking-[0.06em] text-ink-64">
              Attachments
            </h2>
            <AttachmentList attachments={doc.attachments} stripPrefix={stripPrefix} />
          </section>
        ) : null}
      </article>
    </>
  );
}

function ChangesAwareBody({ hast }: { hast: Root }) {
  const changes = useChanges();
  const removed = changes?.showChanges ? changes.diff?.removed : undefined;
  const tree = useMemo(() => (removed ? withRemovedGhosts(hast, removed) : hast), [hast, removed]);
  return <MarkdownBody hast={tree} />;
}

function ReviewChipRow() {
  return (
    <div className="mt-3 flex empty:hidden">
      <ReviewChip />
    </div>
  );
}

function useScrollToHash(ready: boolean): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, hash]);
}

function PlanPaper({
  doc,
  repo,
  index,
}: {
  doc: DocDetail;
  repo: RepoIndex | undefined;
  index: DocsIndex | undefined;
}) {
  const rendered = useRenderedMarkdown(doc, repo, index);
  const toc = rendered?.toc ?? [];
  const activeId = useActiveHeading(toc, SCROLL_CONTAINER_ID);
  useScrollToHash(rendered !== null);
  const body = rendered ? <ChangesAwareBody hast={rendered.hast} /> : null;
  return (
    <PlanContext.Provider value={{ repo: doc.summary.repo, docPath: doc.summary.path }}>
      <ReviewProvider docPath={doc.summary.path} raw={doc.raw} docHash={doc.hash}>
        <ChangesProvider doc={doc}>
          <TopBarSlot>
            <ContentsMenu toc={toc} activeId={activeId} />
          </TopBarSlot>
          <ReviewWorkspace
            headerActions={
              <>
                <HistoryMenu currentHash={doc.hash} />
                <ReviewButton />
              </>
            }
            renderPaper={({ bodyRef, headerActions }) => (
              <Paper doc={doc} repo={repo} body={body} bodyRef={bodyRef} headerActions={headerActions} />
            )}
            renderOverlay={(slots) => <ChangesLayer {...slots} />}
          />
        </ChangesProvider>
      </ReviewProvider>
    </PlanContext.Provider>
  );
}

export function PlanPage() {
  const { repo: repoName = "", "*": rest = "" } = useParams();
  const docPath = `${repoName}/${rest}`;
  const { data: index } = useDocsIndex();
  const { data: doc, error, isLoading } = useDoc(docPath);
  const repo = findRepo(index, repoName);

  if (error) {
    const message =
      error instanceof NotFoundError
        ? "This plan doesn't exist, or it was moved or deleted."
        : "This plan couldn't be loaded.";
    return <EmptyState icon={FileQuestion}>{message}</EmptyState>;
  }
  if (isLoading || !doc) {
    return (
      <div className="px-10 pt-8">
        <div className="mx-auto max-w-[760px] rounded-paper border border-line bg-surface px-14 pt-10 pb-14">
          <PaperSkeleton />
        </div>
      </div>
    );
  }
  return <PlanPaper key={doc.summary.path} doc={doc} repo={repo} index={index} />;
}
