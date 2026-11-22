import type { CodeRepoInfo, ProjectPr, ProjectPrs as ProjectPrsData, ProjectStack } from "@timthink/server";
import { ExternalLink, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { changeProjectPr, type ProjectPrAction } from "../api/projects";
import { useToast } from "../lib/toast";
import { prUrl } from "../markdown/linkPatterns";
import { PrSignals, PrStateDot, prSummaryLines } from "../prs/PrVisuals";

interface ProjectPrsProps {
  projectId: string;
  prs: ProjectPrsData;
  repoLinks: Record<string, CodeRepoInfo>;
  showRepo: boolean;
}

export function ProjectPrs({ projectId, prs, repoLinks, showRepo }: ProjectPrsProps) {
  const [showDetached, setShowDetached] = useState(false);
  if (prs.status === "disabled") {
    return <p className="m-0 text-ui text-ink-64">PR tracking is off in your timthink config.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {prs.status === "unavailable" ? (
        <p className="m-0 text-meta text-bad">Couldn't reach GitHub: {prs.message}</p>
      ) : null}
      {prs.stacks.length === 0 ? (
        <p className="m-0 text-ui text-ink-64">
          No PRs yet. They join from docs' <code>pr:</code> frontmatter, sessions that open them, or{" "}
          <code>timthink project link-pr</code>.
        </p>
      ) : null}
      {prs.stacks.map((stack) => (
        <StackCard
          key={stackKey(stack)}
          stack={stack}
          projectId={projectId}
          codeRepo={repoLinks[stack.repo]}
          showRepo={showRepo}
        />
      ))}
      {prs.detached.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setShowDetached((current) => !current)}
            className="text-meta font-medium text-ink-32 hover:text-ink-64"
          >
            {showDetached ? "Hide" : "Show"} {prs.detached.length} detached
          </button>
          {showDetached ? (
            <ul className="m-0 mt-2 list-none rounded-card border border-line bg-surface p-0">
              {prs.detached.map((pr) => (
                <PrRow
                  key={`${pr.repo}#${pr.number}`}
                  pr={pr}
                  projectId={projectId}
                  codeRepo={repoLinks[pr.repo]}
                  showRepo
                  action="reattach"
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function stackKey(stack: ProjectStack) {
  return `${stack.repo}:${stack.prs.map((pr) => pr.number).join(",")}`;
}

interface StackCardProps {
  stack: ProjectStack;
  projectId: string;
  codeRepo: CodeRepoInfo | undefined;
  showRepo: boolean;
}

function StackCard({ stack, projectId, codeRepo, showRepo }: StackCardProps) {
  return (
    <ul className="m-0 list-none overflow-hidden rounded-card border border-line bg-surface p-0">
      {[...stack.prs].reverse().map((pr) => (
        <PrRow key={pr.number} pr={pr} projectId={projectId} codeRepo={codeRepo} showRepo={showRepo} action="unlink" />
      ))}
    </ul>
  );
}

interface PrRowProps {
  pr: ProjectPr;
  projectId: string;
  codeRepo: CodeRepoInfo | undefined;
  showRepo: boolean;
  action: Extract<ProjectPrAction, "unlink" | "reattach">;
}

function PrRow({ pr, projectId, codeRepo, showRepo, action }: PrRowProps) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const href = codeRepo?.github ? prUrl(codeRepo.github, String(pr.number), codeRepo.prLinks) : (pr.info?.url ?? null);
  const settled = pr.info?.state === "merged" || pr.info?.state === "closed";
  const runAction = async () => {
    setPending(true);
    try {
      await changeProjectPr({ id: projectId, repo: pr.repo, number: pr.number, action });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't update the PR", "bad");
      setPending(false);
    }
  };
  const actionLabel = action === "unlink" ? `Detach #${pr.number} from this project` : `Reattach #${pr.number}`;
  return (
    <li className="group relative flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0">
      <PrStateDot state={pr.info?.state ?? null} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="flex-none font-mono text-meta text-ink-32">
            {showRepo ? `${pr.repo}#` : "#"}
            {pr.number}
          </span>
          <span className={`truncate text-ui ${settled ? "text-ink-64" : "font-medium text-ink"}`}>
            {pr.info?.title ?? "Not fetched yet"}
          </span>
          {pr.info ? <PrSignals info={pr.info} /> : null}
        </span>
        <span className="block truncate text-meta text-ink-64">
          {pr.info ? prSummaryLines(pr.info).join(" · ") : "Waiting for GitHub"}
          {pr.sources.includes("stack") && pr.sources.length === 1 ? " · in the stack" : null}
        </span>
      </span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open #${pr.number}`}
          className="grid size-7 flex-none place-items-center rounded-[6px] text-ink-32 hover:bg-line-soft hover:text-ink"
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
        </a>
      ) : null}
      <button
        type="button"
        onClick={() => void runAction()}
        disabled={pending}
        aria-label={actionLabel}
        title={actionLabel}
        className="grid size-7 flex-none place-items-center rounded-[6px] text-ink-32 opacity-0 transition-opacity duration-150 hover:bg-line-soft hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
      >
        {action === "unlink" ? (
          <X className="size-3.5" strokeWidth={1.75} aria-hidden />
        ) : (
          <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden />
        )}
      </button>
    </li>
  );
}
