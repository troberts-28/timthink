import { useQueryClient } from "@tanstack/react-query";
import type { StepResult } from "@timthink/server";
import { Check, X } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import { recordStep } from "../api/projects";
import { queryKeys, useChecklist } from "../api/queries";
import { relativeTime } from "../lib/format";
import { useToast } from "../lib/toast";
import { type PageScope, usePageScope } from "./projectContext";

const SHORT_SHA = 7;

export function Checklist({ id, pr, children }: { id: string; pr?: number; children: ReactNode }) {
  const scope = usePageScope();
  const { data } = useChecklist(scope.ownerId, id);
  const queryClient = useQueryClient();
  const toast = useToast();
  const headSha = pr === undefined ? null : prHeadSha(scope, pr);
  const results = data?.steps ?? {};
  const record = async (stepId: string, result: Omit<StepResult, "at"> | null) => {
    try {
      const updated = await recordStep({ id: scope.ownerId, checklist: id, step: stepId, result });
      queryClient.setQueryData(queryKeys.checklist(scope.ownerId, id), updated);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't save the step", "bad");
    }
  };
  const recorded = Object.values(results);
  const passedOnHead = recorded.filter((result) => result.outcome === "pass" && !isStale(result, headSha)).length;
  return (
    <ChecklistContext.Provider value={{ results, headSha, record }}>
      <div data-block-id={id} className="mb-[18px] overflow-hidden rounded-card border border-line bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-2 text-meta text-ink-64">
          <span>
            {pr === undefined ? "Checklist" : `Checklist for #${pr}`}
            {headSha ? (
              <>
                {" "}
                at <code className="font-mono">{headSha.slice(0, SHORT_SHA)}</code>
              </>
            ) : null}
          </span>
          <span>{passedOnHead} passed on this head</span>
        </div>
        <ol className="m-0 list-none p-0">{children}</ol>
      </div>
    </ChecklistContext.Provider>
  );
}

export function Step({ id, children }: { id: string; children: ReactNode }) {
  const checklist = useContext(ChecklistContext);
  const result = checklist?.results[id] ?? null;
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(result?.note ?? "");
  if (!checklist) {
    throw new Error("Step only works inside a Checklist");
  }
  const stale = result !== null && isStale(result, checklist.headSha);
  const openNote = () => {
    setNote(result?.note ?? "");
    setNoteOpen(true);
  };
  const mark = (outcome: StepResult["outcome"]) =>
    checklist.record(id, result?.outcome === outcome && !stale ? null : { outcome, note, sha: checklist.headSha });
  const saveNote = () => {
    if (result && note !== result.note) {
      void checklist.record(id, { outcome: result.outcome, note, sha: result.sha });
    }
  };
  return (
    <li className="border-b border-line-soft px-4 py-2.5 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="flex flex-none gap-1 pt-0.5">
          <OutcomeButton
            label="Pass"
            active={result?.outcome === "pass" && !stale}
            tone="ok"
            onClick={() => void mark("pass")}
          >
            <Check className="size-3.5" aria-hidden />
          </OutcomeButton>
          <OutcomeButton
            label="Fail"
            active={result?.outcome === "fail" && !stale}
            tone="bad"
            onClick={() => void mark("fail")}
          >
            <X className="size-3.5" aria-hidden />
          </OutcomeButton>
        </span>
        <div className="min-w-0 flex-1 text-ui">
          <div className="text-ink">{children}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-meta text-ink-64">
            {result ? <StepStatus result={result} stale={stale} /> : <span>Not checked</span>}
            {result ? (
              <button type="button" className="text-ink-64 underline-offset-2 hover:underline" onClick={openNote}>
                {result.note ? "Edit note" : "Add note"}
              </button>
            ) : null}
          </div>
          {result?.note && !noteOpen ? <p className="m-0 mt-1 text-meta text-ink">{result.note}</p> : null}
          {noteOpen ? (
            <textarea
              // biome-ignore lint/a11y/noAutofocus: the note field opens on an explicit click and is where the next keystroke belongs.
              autoFocus
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onBlur={() => {
                saveNote();
                setNoteOpen(false);
              }}
              rows={2}
              placeholder="What did you see?"
              className="mt-1.5 block w-full resize-y rounded-button border border-line bg-surface px-2.5 py-1.5 text-meta text-ink outline-none focus:border-accent"
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}

function StepStatus({ result, stale }: { result: StepResult; stale: boolean }) {
  const sha = result.sha ? ` on ${result.sha.slice(0, SHORT_SHA)}` : "";
  const verb = result.outcome === "pass" ? "Passed" : "Failed";
  return (
    <span className={stale ? "text-ink-32" : result.outcome === "pass" ? "text-ok-ink" : "text-bad-ink"}>
      {stale ? `Stale: ${verb.toLowerCase()}${sha}, before the latest push` : `${verb}${sha}`} ·{" "}
      {relativeTime(Date.parse(result.at))}
    </span>
  );
}

function OutcomeButton({
  label,
  active,
  tone,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  tone: "ok" | "bad";
  onClick: () => void;
  children: ReactNode;
}) {
  const activeClass = tone === "ok" ? "border-ok bg-ok text-surface" : "border-bad bg-bad text-surface";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`grid size-6 place-items-center rounded-chip border transition-colors duration-150 ${
        active ? activeClass : "border-line text-ink-32 hover:border-ink-32 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function prHeadSha(scope: PageScope, number: number) {
  const prs = scope.stacks.flatMap((stack) => stack.prs).filter((candidate) => candidate.number === number);
  const pr = prs.find((candidate) => candidate.repo === scope.defaultRepo) ?? prs[0];
  return pr?.info?.headSha ?? null;
}

function isStale(result: StepResult, headSha: string | null) {
  return headSha !== null && result.sha !== null && result.sha !== headSha;
}

interface ChecklistState {
  results: Record<string, StepResult>;
  headSha: string | null;
  record: (stepId: string, result: Omit<StepResult, "at"> | null) => Promise<void>;
}

const ChecklistContext = createContext<ChecklistState | null>(null);
