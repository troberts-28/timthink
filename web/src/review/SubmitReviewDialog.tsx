import type { Verdict } from "@timthink/server";
import { CircleCheck, CircleDot, MessageSquare, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useDocSessions } from "../api/queries";
import { Button } from "../components/Button";
import { pluralise } from "../lib/format";
import { useToast } from "../lib/toast";
import { defaultHandOffTarget, HandOffTarget } from "./HandOffTarget";
import { type HandOffOutcome, handOffToClaude } from "./handOff";
import { useRequiredReview } from "./ReviewContext";
import { pendingCounts } from "./reviewModel";

interface VerdictOption {
  value: Verdict;
  label: string;
  description: string;
  icon: ReactNode;
}

const VERDICTS: readonly VerdictOption[] = [
  {
    value: "approve",
    label: "Approve",
    description: "Good to go. Sets the plan's status to approved.",
    icon: <CircleCheck className="size-4" aria-hidden />,
  },
  {
    value: "request_changes",
    label: "Request changes",
    description: "Needs another pass. Sets the status back to draft.",
    icon: <CircleDot className="size-4" aria-hidden />,
  },
  {
    value: "comment",
    label: "Comment",
    description: "Feedback without a decision. The status stays as it is.",
    icon: <MessageSquare className="size-4" aria-hidden />,
  },
];

function CommandCode({ command }: { command: string }) {
  return <code className="font-mono text-[12.5px]">{command}</code>;
}

function handOffMessage(outcome: HandOffOutcome): ReactNode {
  if (outcome.kind === "resumed") {
    return "Resuming the session in a new Warp tab. Claude starts on your review straight away.";
  }
  if (!outcome.copied) {
    return (
      <>
        Couldn't copy to the clipboard. Run <CommandCode command={outcome.command} /> in a Claude session.
      </>
    );
  }
  if (outcome.kind === "focused") {
    return (
      <>
        Jumped to the Claude tab. Paste and press Enter to send <CommandCode command={outcome.command} />
      </>
    );
  }
  if (outcome.kind === "possibly-open") {
    return (
      <>
        “{outcome.title}” may already be open in a Warp tab that timthink can't see, so it wasn't resumed. Paste the
        copied <CommandCode command={outcome.command} /> into that tab, or use Resume in the Sessions panel.
      </>
    );
  }
  return (
    <>
      Copied <CommandCode command={outcome.command} />. Paste it into a Claude session.
    </>
  );
}

function useEscape(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);
}

export function SubmitReviewDialog() {
  const { review, docPath, submitOpen, setSubmitOpen, requestedVerdict, actions } = useRequiredReview();
  const toast = useToast();
  const [verdict, setVerdict] = useState<Verdict>("approve");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [chosenTarget, setChosenTarget] = useState<string | null>(null);
  const { data: sessionsData } = useDocSessions(docPath);
  const sessions = sessionsData?.sessions ?? [];
  const target = chosenTarget ?? defaultHandOffTarget(sessions);
  const titleId = useId();
  const close = () => {
    setSubmitOpen(false);
    setChosenTarget(null);
  };
  useEscape(submitOpen, close);
  useEffect(() => {
    if (submitOpen) setVerdict(requestedVerdict ?? "approve");
  }, [submitOpen, requestedVerdict]);
  if (!submitOpen) return null;
  const counts = pendingCounts(review);

  const submit = async () => {
    setSubmitting(true);
    const result = await actions.submit(verdict, body);
    setSubmitting(false);
    if (!result) return;
    const session = sessions.find((candidate) => candidate.id === target) ?? null;
    close();
    setBody("");
    setVerdict("approve");
    if (result.statusUpdate.status === "failed") {
      toast(`Review submitted, but the status wasn't changed: ${result.statusUpdate.message}`, "bad");
    }
    toast(handOffMessage(await handOffToClaude(docPath, session)));
  };

  return (
    <div className="dialog-backdrop fixed inset-0 z-50 grid place-items-center p-6" role="presentation">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog-panel relative flex w-[min(560px,100%)] flex-col gap-5 rounded-card border border-line bg-surface-raised p-6 shadow-modal"
      >
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="m-0 text-[18px] leading-[26px] font-semibold text-ink">
              Submit review
            </h2>
            <p className="m-0 mt-1 text-ui text-ink-64">
              {counts.total > 0
                ? `Sends ${[
                    counts.comments > 0 ? pluralise(counts.comments, "comment") : null,
                    counts.replies > 0 ? pluralise(counts.replies, "reply", "replies") : null,
                    counts.answers > 0 ? pluralise(counts.answers, "answer") : null,
                  ]
                    .filter(Boolean)
                    .join(", ")} to Claude.`
                : "No draft comments. You can still leave a verdict and an overall comment."}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid size-8 flex-none place-items-center rounded-button text-ink-64 hover:bg-bg-sunken hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <textarea
          // biome-ignore lint/a11y/noAutofocus: the dialog opens on an explicit action and the comment is its first field.
          autoFocus
          rows={4}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
          }}
          placeholder="Overall comment (optional)"
          className="field text-ui"
        />
        <fieldset className="m-0 grid grid-cols-1 gap-2 border-0 p-0 sm:grid-cols-3">
          <legend className="sr-only">Verdict</legend>
          {VERDICTS.map((option) => (
            <label key={option.value} className={`verdict-card verdict-${option.value}`}>
              <input
                type="radio"
                name="verdict"
                value={option.value}
                checked={verdict === option.value}
                onChange={() => setVerdict(option.value)}
                className="sr-only"
              />
              <span className="verdict-title">
                {option.icon}
                {option.label}
              </span>
              <span className="text-meta text-ink-64">{option.description}</span>
            </label>
          ))}
        </fieldset>
        <HandOffTarget sessions={sessions} selectedId={target} onSelect={setChosenTarget} />
        <footer className="flex items-center justify-end gap-3">
          <div className="flex gap-2">
            <Button size="lg" tone="ghost" onClick={close}>
              Cancel
            </Button>
            <Button size="lg" tone="primary" disabled={submitting} onClick={() => void submit()}>
              Submit review
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
