import { useQueryClient } from "@tanstack/react-query";
import type { Round, RoundItem, RoundView } from "@timthink/server";
import { ListChecks, Play, SquareTerminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { NotFoundError } from "../api/client";
import { queryKeys, useRound } from "../api/queries";
import { abandonRound, submitRound } from "../api/rounds";
import { Button } from "../components/Button";
import { CopyCommandButton } from "../components/CopyCommandButton";
import { EmptyState } from "../components/EmptyState";
import { PageContainer, PageHeader, SectionHeading } from "../components/PageHeader";
import { projectEntryHref } from "../lib/routes";
import { useToast } from "../lib/toast";
import { isTypingTarget } from "../lib/useKeyboardNav";
import { handOffCommand } from "../review/handOff";
import { handOffMessage } from "../review/handOffMessage";
import { DecisionSaver } from "./decisionSaver";
import { decisionFromDraft, draftFromDecision, type ItemDraft, withOption, withOther } from "./itemDraft";
import {
  type DraftChange,
  RoundItemCard,
  roundItemElementId,
  roundOtherElementId,
  roundReplyElementId,
} from "./RoundItemCard";

export function RoundPage() {
  const { id = "" } = useParams();
  const { data: view, error, isLoading } = useRound(id);
  if (error) {
    return (
      <PageContainer>
        <EmptyState icon={ListChecks}>
          {error instanceof NotFoundError ? "There is no round with that id." : "This round couldn't be loaded."}
        </EmptyState>
      </PageContainer>
    );
  }
  if (isLoading || !view) {
    return <PageContainer>{null}</PageContainer>;
  }
  return <RoundWorkspace key={view.round.id} view={view} />;
}

const STATE_LABELS: Record<Round["state"], string> = {
  open: "Waiting on you",
  submitted: "Submitted, Claude is on it",
  done: "Done",
  abandoned: "Abandoned",
};

function RoundWorkspace({ view }: { view: RoundView }) {
  const { round } = view;
  const toast = useToast();
  const queryClient = useQueryClient();
  const editable = round.state === "open";
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>(() =>
    Object.fromEntries(round.items.map((item) => [item.id, draftFromDecision(round.decisions[item.id])])),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const saver = useMemo(
    () =>
      new DecisionSaver(round.id, {
        onSaved: (saved) => queryClient.setQueryData(queryKeys.round(round.id), saved),
        onError: (error) => toast(error instanceof Error ? error.message : "Couldn't save the decision", "bad"),
      }),
    [round.id, queryClient, toast],
  );
  const draftOf = (item: RoundItem) => drafts[item.id] ?? draftFromDecision(undefined);
  const undecided = round.items.filter((item) => decisionFromDraft(draftOf(item)) === null).length;

  const changeDraft = (item: RoundItem, { draft, typing }: DraftChange) => {
    setDrafts((current) => ({ ...current, [item.id]: draft }));
    const decision = decisionFromDraft(draft);
    if (decision && typing) {
      saver.saveSoon(item.id, decision);
    } else if (decision) {
      saver.saveNow(item.id, decision);
    }
  };

  const submit = async () => {
    if (!editable || undecided > 0 || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await saver.flush();
      const submitted = await submitRound(round.id);
      queryClient.setQueryData(queryKeys.round(round.id), submitted);
      toast(
        submitted.waiting
          ? "Submitted. The waiting session picks it up now."
          : "Submitted, but no session is waiting. Resume one to act on it.",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't submit the round", "bad");
    } finally {
      setSubmitting(false);
    }
  };

  const latest = useRef({ drafts, activeIndex, submit, changeDraft });
  latest.current = { drafts, activeIndex, submit, changeDraft };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleRoundKey({ event, round, editable, latest: latest.current, setActiveIndex });
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [round, editable]);

  const byPr = round.prs.map((pr) => ({ pr, items: round.items.filter((item) => item.pr === pr.number) }));
  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          round.project ? (
            <Link to={projectEntryHref(round.project)} className="hover:text-ink">
              {round.project}
            </Link>
          ) : (
            round.repo
          )
        }
        title={round.title}
        meta={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="chip chip-neutral">{STATE_LABELS[round.state]}</span>
            <span>
              {round.items.length - undecided} of {round.items.length} decided
            </span>
            {round.prs.map((pr) => (
              <a key={pr.number} href={pr.link} target="_blank" rel="noreferrer" className="hover:text-ink">
                #{pr.number}
              </a>
            ))}
          </span>
        }
      />
      <SessionBanner view={view} />
      <div className="flex flex-col gap-10">
        {byPr.map(({ pr, items }) => (
          <section key={pr.number} aria-label={`#${pr.number}`}>
            {round.prs.length > 1 ? (
              <SectionHeading aside={`${items.length} comment${items.length === 1 ? "" : "s"}`}>
                #{pr.number} {pr.title}
              </SectionHeading>
            ) : null}
            <div className="flex flex-col gap-4">
              {items.map((item) => {
                const index = round.items.indexOf(item);
                return (
                  <RoundItemCard
                    key={item.id}
                    roundId={round.id}
                    item={item}
                    index={index}
                    draft={draftOf(item)}
                    outcome={round.outcomes[item.id] ?? null}
                    editable={editable}
                    active={editable && index === activeIndex}
                    onActivate={() => setActiveIndex(index)}
                    onChange={(change) => changeDraft(item, change)}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {editable ? (
        <SubmitBar roundId={round.id} undecided={undecided} submitting={submitting} onSubmit={() => void submit()} />
      ) : null}
    </PageContainer>
  );
}

interface RoundKeyContext {
  event: KeyboardEvent;
  round: Round;
  editable: boolean;
  latest: {
    drafts: Record<string, ItemDraft>;
    activeIndex: number;
    submit: () => Promise<void>;
    changeDraft: (item: RoundItem, change: DraftChange) => void;
  };
  setActiveIndex: (index: number) => void;
}

function handleRoundKey({ event, round, editable, latest, setActiveIndex }: RoundKeyContext) {
  if (!editable) {
    return;
  }
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void latest.submit();
    return;
  }
  if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  const item = round.items[latest.activeIndex];
  if (event.key === "j" || event.key === "k") {
    event.preventDefault();
    const next = Math.min(round.items.length - 1, Math.max(0, latest.activeIndex + (event.key === "j" ? 1 : -1)));
    setActiveIndex(next);
    const nextItem = round.items[next];
    if (nextItem) {
      document.getElementById(roundItemElementId(nextItem.id))?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    return;
  }
  if (!item) {
    return;
  }
  const draft = latest.drafts[item.id] ?? draftFromDecision(undefined);
  if (event.key === "r") {
    event.preventDefault();
    document.getElementById(roundReplyElementId(item.id))?.focus();
    return;
  }
  const picked = Number.parseInt(event.key, 10);
  if (picked >= 1 && picked <= item.options.length) {
    const option = item.options[picked - 1];
    if (option) {
      latest.changeDraft(item, { draft: withOption(item, draft, option.id), typing: false });
    }
  } else if (picked === item.options.length + 1) {
    event.preventDefault();
    latest.changeDraft(item, { draft: withOther(item, draft), typing: false });
    window.setTimeout(() => document.getElementById(roundOtherElementId(item.id))?.focus());
  }
}

function SessionBanner({ view }: { view: RoundView }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { round, session, waiting, resumePrompt } = view;
  const awaitingSession = round.state === "submitted" && Object.keys(round.outcomes).length === 0;
  if (waiting || !(round.state === "open" || awaitingSession)) {
    return null;
  }
  const focus = Boolean(session?.live && session.warpFocusUrl);
  const handOff = async () => {
    setBusy(true);
    const outcome = await handOffCommand(resumePrompt, session, { round: round.id });
    toast(handOffMessage(outcome, "this round"));
    setBusy(false);
  };
  return (
    <div className="mb-8 flex items-center gap-3 rounded-card border border-line bg-bg-sunken/60 px-4 py-3 text-ui">
      <p className="m-0 min-w-0 flex-1 text-ink-64">
        {round.state === "open"
          ? "No session is waiting for this round. Decide anyway; a resumed session picks up your decisions."
          : "Submitted, but no session is waiting to act on it."}
      </p>
      <Button
        tone="primary"
        disabled={busy}
        icon={focus ? <SquareTerminal className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
        onClick={() => void handOff()}
        title={session ? session.title : `Copy ${resumePrompt}`}
      >
        {focus ? "Focus in Warp" : session?.canResume ? "Resume in Warp" : "Copy command"}
      </Button>
      <CopyCommandButton command={resumePrompt} label="Copy the resume command" />
    </div>
  );
}

interface SubmitBarProps {
  roundId: string;
  undecided: number;
  submitting: boolean;
  onSubmit: () => void;
}

function SubmitBar({ roundId, undecided, submitting, onSubmit }: SubmitBarProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  const abandon = async () => {
    if (!confirmingAbandon) {
      setConfirmingAbandon(true);
      return;
    }
    try {
      queryClient.setQueryData(queryKeys.round(roundId), await abandonRound(roundId));
      toast("Abandoned the round");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't abandon the round", "bad");
    }
  };
  return (
    <div className="sticky bottom-0 mt-10 -mx-4 flex items-center gap-3 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur">
      <p className="m-0 flex-1 text-meta text-ink-64">
        {undecided > 0 ? `${undecided} left to decide` : "Every item is decided"} · <kbd>j</kbd>/<kbd>k</kbd> move,{" "}
        <kbd>1</kbd> to <kbd>4</kbd> pick, <kbd>r</kbd> reply, <kbd>⌘↵</kbd> submit
      </p>
      <Button tone={confirmingAbandon ? "danger" : "ghost"} onClick={() => void abandon()}>
        {confirmingAbandon ? "Abandon for good" : "Abandon"}
      </Button>
      <Button tone="primary" disabled={undecided > 0 || submitting} onClick={onSubmit}>
        Submit decisions
      </Button>
    </div>
  );
}
