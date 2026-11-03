import type { BuildRequest, DocDetail, PhaseSummary, SessionView } from "@timthink/server";
import { isValidBranchName, suggestBranch } from "@timthink/server/shared";
import { Hammer, PauseCircle, SquareSplitHorizontal } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useLocalString } from "../lib/localSetting";
import { CommandCode, handOffMessage } from "../review/handOffMessage";
import {
  type BuildOutcome,
  type BuildTargetKind,
  kindOf,
  NEW_SESSION,
  NOT_NOW,
  plannerOf,
  targetFor,
} from "./buildHandOff";

const TARGET_SETTING = "timthink:build-target";
const MAX_SESSIONS = 3;
const ALL_PHASES = "all";

function isTargetKind(value: string | null): value is BuildTargetKind {
  return value === "new" || value === "planner" || value === "not-now";
}

function openPhases(phases: readonly PhaseSummary[]): PhaseSummary[] {
  return phases.filter((phase) => phase.tasks.total === 0 || phase.tasks.done < phase.tasks.total);
}

export interface BuildOptionsState {
  target: string;
  setTarget: (target: string) => void;
  branch: string;
  setBranch: (branch: string) => void;
  phase: number | null;
  setPhase: (phase: number | null) => void;
  request: BuildRequest;
  branchValid: boolean;
  phases: PhaseSummary[];
  sessions: readonly SessionView[];
  allowNotNow: boolean;
}

export interface PlanForBuild {
  path: string;
  branch: string | null;
  phases: readonly PhaseSummary[];
}

export function planForBuild(docPath: string, doc: DocDetail | undefined): PlanForBuild {
  return { path: docPath, branch: doc?.summary.branch ?? null, phases: doc?.phases ?? [] };
}

export function useBuildOptions(
  plan: PlanForBuild,
  sessions: readonly SessionView[],
  { allowNotNow }: { allowNotNow: boolean },
): BuildOptionsState & { reset: () => void } {
  const [remembered, setRemembered] = useLocalString(TARGET_SETTING);
  const [chosenTarget, setChosenTarget] = useState<string | null>(null);
  const planBranch = plan.branch;
  const [editedBranch, setBranch] = useState<string | null>(null);
  const branch = editedBranch ?? planBranch ?? suggestBranch(plan.path);
  const [phase, setPhase] = useState<number | null>(null);
  const target = chosenTarget ?? targetFor(isTargetKind(remembered) ? remembered : "new", sessions, allowNotNow);
  const trimmed = branch.trim();
  const request: BuildRequest = {
    doc: plan.path,
    phase,
    branch: trimmed && trimmed !== planBranch ? trimmed : null,
  };
  return {
    target,
    setTarget: (next) => {
      setChosenTarget(next);
      setRemembered(kindOf(next));
    },
    branch,
    setBranch,
    phase,
    setPhase,
    request,
    branchValid: trimmed === "" || isValidBranchName(trimmed),
    phases: openPhases(plan.phases),
    sessions,
    allowNotNow,
    reset: () => {
      setChosenTarget(null);
      setBranch(null);
      setPhase(null);
    },
  };
}

function directoryName(directory: string | null): string | null {
  return directory ? (directory.split("/").filter(Boolean).pop() ?? directory) : null;
}

function sessionTags(session: SessionView): string[] {
  return [session.plannedDoc ? "Planned" : null, session.builtDoc ? "Built" : null].filter(
    (tag): tag is string => tag !== null,
  );
}

function sessionWhatHappens(session: SessionView): string {
  if (session.live && session.warpFocusUrl) return "Jumps to its tab; paste to start building";
  if (session.mayBeOpenUntracked) return "May already be open in a tab timthink can't see";
  if (session.canResume) return "Resumes in a new tab and starts building";
  return "Can't be opened";
}

function Option({
  checked,
  onSelect,
  title,
  detail,
  icon,
  tags = [],
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: ReactNode;
  icon?: ReactNode;
  tags?: string[];
}) {
  return (
    <label className={`handoff-option ${checked ? "is-checked" : ""}`}>
      <input type="radio" name="build-target" checked={checked} onChange={onSelect} className="sr-only" />
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="truncate text-ui font-medium text-ink">{title}</span>
        {tags.map((tag) => (
          <span key={tag} className="handoff-tag">
            {tag}
          </span>
        ))}
      </span>
      <span className="text-meta text-ink-64">{detail}</span>
    </label>
  );
}

function newSessionDetail(sessions: readonly SessionView[]): string {
  const planner = plannerOf(sessions);
  const where = directoryName(planner?.cwd ?? null);
  if (planner?.live && planner.warpFocusUrl) {
    return `Copies a command for a fresh Claude${where ? ` in ${where}` : ""} and jumps to the planning tab; split a pane (⌘D) and paste`;
  }
  return `Copies a command for a fresh Claude${where ? ` in ${where}` : ""}; paste it into any terminal pane`;
}

function candidateSessions(sessions: readonly SessionView[], selected: string): SessionView[] {
  const ranked = [...sessions].sort(
    (a, b) => Number(Boolean(b.plannedDoc)) - Number(Boolean(a.plannedDoc)) || Number(b.live) - Number(a.live),
  );
  const shown = ranked.slice(0, MAX_SESSIONS);
  const chosen = sessions.find((session) => session.id === selected);
  return chosen && !shown.includes(chosen) ? [...shown.slice(0, MAX_SESSIONS - 1), chosen] : shown;
}

export function BuildOptions({ state }: { state: BuildOptionsState }) {
  const branchId = useId();
  const phaseId = useId();
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <label htmlFor={branchId} className="flex min-w-0 flex-col gap-1.5">
          <span className="text-meta font-semibold text-ink-64">Branch</span>
          <input
            id={branchId}
            value={state.branch}
            onChange={(event) => state.setBranch(event.target.value)}
            spellCheck={false}
            aria-invalid={!state.branchValid}
            className="field font-mono text-[12.5px]"
          />
          {!state.branchValid ? <span className="text-meta text-bad-ink">That isn't a valid branch name</span> : null}
        </label>
        {state.phases.length > 0 ? (
          <label htmlFor={phaseId} className="flex flex-col gap-1.5">
            <span className="text-meta font-semibold text-ink-64">Phase</span>
            <select
              id={phaseId}
              value={state.phase === null ? ALL_PHASES : String(state.phase)}
              onChange={(event) =>
                state.setPhase(event.target.value === ALL_PHASES ? null : Number(event.target.value))
              }
              className="field h-[34px] py-0 text-ui"
            >
              <option value={ALL_PHASES}>Everything left</option>
              {state.phases.map((phase) => (
                <option key={phase.number} value={phase.number}>
                  Phase {phase.number}
                  {phase.title ? `: ${phase.title}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-2 p-0 text-meta font-semibold text-ink-64">Build in</legend>
        <Option
          checked={state.target === NEW_SESSION}
          onSelect={() => state.setTarget(NEW_SESSION)}
          icon={<SquareSplitHorizontal className="size-3.5 text-ink-64" aria-hidden />}
          title="A new session"
          detail={newSessionDetail(state.sessions)}
        />
        {candidateSessions(state.sessions, state.target).map((session) => (
          <Option
            key={session.id}
            checked={state.target === session.id}
            onSelect={() => state.setTarget(session.id)}
            title={session.title}
            tags={sessionTags(session)}
            detail={sessionWhatHappens(session)}
          />
        ))}
        {state.allowNotNow ? (
          <Option
            checked={state.target === NOT_NOW}
            onSelect={() => state.setTarget(NOT_NOW)}
            icon={<PauseCircle className="size-3.5 text-ink-64" aria-hidden />}
            title="Not now"
            detail="Just approve; build later with the Build button"
          />
        ) : null}
      </fieldset>
    </div>
  );
}

export function buildMessage(outcome: BuildOutcome): ReactNode {
  if (outcome.kind === "skipped") return null;
  if (outcome.kind === "planner") return handOffMessage(outcome.handOff, "the build");
  if (!outcome.copied) {
    return (
      <>
        Couldn't copy to the clipboard. Run <CommandCode command={outcome.command} /> in a new terminal pane.
      </>
    );
  }
  if (outcome.focused) {
    return (
      <>
        <Hammer className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
        Jumped to the planning tab. Split a pane (⌘D), paste and press Return to run{" "}
        <CommandCode command={outcome.command} />
      </>
    );
  }
  return (
    <>
      Copied <CommandCode command={outcome.command} />. Paste it into a new terminal pane.
      {outcome.problem ? ` (${outcome.problem})` : ""}
    </>
  );
}
