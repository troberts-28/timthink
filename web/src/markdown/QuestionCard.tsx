import type { Answer, Thread } from "@timthink/server";
import { parseQuestionBlock, type QuestionBlock, type QuestionOption } from "@timthink/server/shared";
import { Check, CircleHelp } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { type ReviewContextValue, useReviewContext } from "../review/ReviewContext";
import { answersFor } from "../review/reviewModel";
import { InlineText } from "./InlineText";
import { QuestionContext } from "./QuestionContext";

interface SourceRange {
  start: number;
  end: number;
}

interface QuestionCardProps {
  code: string;
  attributes: Record<string, string>;
  sourceProps: Record<string, string>;
  details: ReactNode | null;
  detailsRange: SourceRange | null;
}

type AnswerStatus = "unanswered" | "draft" | "sent" | "answered";

function statusOf(draft: Answer | null, latest: Answer | null): AnswerStatus {
  if (draft) return "draft";
  if (latest?.ack) return "answered";
  if (latest) return "sent";
  return "unanswered";
}

const STATUS_LABELS: Record<Exclude<AnswerStatus, "unanswered">, { label: string; className: string }> = {
  draft: { label: "Draft answer", className: "chip-accent" },
  sent: { label: "Sent to Claude", className: "chip-info" },
  answered: { label: "Answered", className: "chip-ok-soft" },
};

function OptionMarker({ selected }: { selected: boolean }) {
  return (
    <span
      className={`mt-[5px] grid size-3.5 flex-none place-items-center rounded-full border-[1.5px] transition-colors duration-150 ${
        selected ? "border-accent bg-accent" : "border-ink-32"
      }`}
      aria-hidden
    >
      {selected ? <span className="size-1.5 rounded-full bg-surface" /> : null}
    </span>
  );
}

export function OptionText({ option }: { option: QuestionOption }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block">
          <InlineText text={option.label} />
        </span>
        {option.summary ? (
          <span className="question-option-summary">
            <InlineText text={option.summary} />
          </span>
        ) : null}
      </span>
      {option.recommended ? <span className="chip chip-accent question-recommended">Recommended</span> : null}
    </>
  );
}

export function StaticOptions({ options }: { options: readonly QuestionOption[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {options.map((option) => (
        <li key={option.label} className="question-option m-0">
          <OptionMarker selected={false} />
          <OptionText option={option} />
        </li>
      ))}
    </ul>
  );
}

function InteractiveOptions({
  question,
  selected,
  onPick,
}: {
  question: QuestionBlock;
  selected: number | null;
  onPick: (index: number) => void;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Options">
      {question.options.map((option, index) => {
        const isSelected = selected === index;
        return (
          <li key={option.label} className="m-0">
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onPick(index)}
              className={`question-option is-interactive ${isSelected ? "is-selected" : ""}`}
            >
              <OptionMarker selected={isSelected} />
              <OptionText option={option} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function InteractiveAnswer({
  question,
  review,
  context,
}: {
  question: QuestionBlock & { id: string };
  review: ReviewContextValue;
  context: ReactNode;
}) {
  const { draft, latest } = answersFor(review.review, question.id);
  const shown = draft ?? latest;
  const shownNote = shown?.note ?? "";
  const shownChoice = shown?.choice ?? null;
  const [note, setNote] = useState(shownNote);
  const [selected, setSelected] = useState<number | null>(shownChoice);
  useEffect(() => setNote(shownNote), [shownNote]);
  useEffect(() => setSelected(shownChoice), [shownChoice]);

  const save = (choice: number | null, nextNote: string) =>
    review.actions.saveAnswer({
      questionId: question.id,
      prompt: question.prompt,
      choice,
      choiceText: choice === null ? null : (question.options[choice]?.label ?? null),
      note: nextNote,
    });

  const pick = (index: number) => {
    const choice = selected === index ? null : index;
    setSelected(choice);
    void save(choice, note);
  };
  const saveNote = () => {
    if (note.trim() !== shownNote.trim()) void save(selected, note);
  };
  const status = statusOf(draft, latest);

  return (
    <>
      <InteractiveOptions question={question} selected={selected} onPick={pick} />
      {context}
      <textarea
        rows={note ? 2 : 1}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={saveNote}
        placeholder="Add a note (optional)"
        aria-label="Note for Claude"
        className="field mt-3 text-[14px]"
      />
      <div className="mt-2.5 flex min-h-5 items-center gap-2 text-meta text-ink-64">
        {status === "unanswered" ? (
          <span className="text-ink-32">Your answer is saved as a draft and sent with your next review.</span>
        ) : (
          <span className={`chip ${STATUS_LABELS[status].className}`}>
            {status === "answered" ? <Check className="size-3" aria-hidden /> : null}
            {STATUS_LABELS[status].label}
          </span>
        )}
        {status === "draft" ? <span className="text-ink-32">Sent when you submit your review.</span> : null}
        {status === "answered" && latest?.ack?.message ? (
          <span className="min-w-0 truncate" title={latest.ack.message}>
            Claude: {latest.ack.message}
          </span>
        ) : null}
      </div>
    </>
  );
}

function within(range: SourceRange, start: number, end: number): boolean {
  return start < range.end && end > range.start;
}

function threadInside(range: SourceRange | null, threads: readonly Thread[], id: string | null): boolean {
  if (!range) return false;
  return threads.some(
    (thread) =>
      (id === null ? thread.status === "open" : thread.id === id) &&
      within(range, thread.anchor.start, thread.anchor.end),
  );
}

function useContextOpen(review: ReviewContextValue | null, range: SourceRange | null) {
  const [open, setOpen] = useState(false);
  const threads = review?.review?.threads ?? [];
  const current = review?.anchorsCurrent ?? false;
  const hasOpenThreads = current && threadInside(range, threads, null);
  const activeInside = current && review?.activeThreadId ? threadInside(range, threads, review.activeThreadId) : false;
  const composer = review?.composer ?? null;
  const composing = range !== null && composer !== null && within(range, composer.start, composer.end);
  const reveal = hasOpenThreads || activeInside || composing;
  useEffect(() => {
    if (reveal) setOpen(true);
  }, [reveal]);
  return [open, setOpen] as const;
}

export function QuestionCard({ code, attributes, sourceProps, details, detailsRange }: QuestionCardProps) {
  const question = parseQuestionBlock(code, attributes);
  const review = useReviewContext();
  const [contextOpen, setContextOpen] = useContextOpen(review, detailsRange);
  const answered = review && question.id ? answersFor(review.review, question.id).latest?.ack : null;
  const context = details ? (
    <QuestionContext open={contextOpen} onToggle={() => setContextOpen((value) => !value)}>
      {details}
    </QuestionContext>
  ) : null;
  return (
    <section
      id={question.id ? `question-${question.id}` : undefined}
      className={`fence not-prose question-card scroll-mt-24 overflow-hidden rounded-card border bg-surface ${answered ? "border-ok/50" : "border-line"}`}
      aria-label="Open question"
      {...sourceProps}
    >
      <header
        className={`flex items-center gap-2 border-b border-line-soft px-4 py-2.5 text-meta ${answered ? "bg-ok-soft" : "bg-accent-soft"}`}
      >
        {answered ? (
          <Check className="size-4 text-ok-ink" aria-hidden />
        ) : (
          <CircleHelp className="size-4 text-accent-ink" aria-hidden />
        )}
        <span className={`font-semibold uppercase tracking-[0.04em] ${answered ? "text-ok-ink" : "text-accent-ink"}`}>
          {answered ? "Answered question" : "Open question"}
        </span>
        {question.id ? (
          <span className={`ml-auto font-mono ${answered ? "text-ok-ink" : "text-accent-ink"}`}>{question.id}</span>
        ) : null}
      </header>
      <div className="px-4 pt-3.5 pb-4">
        <p className="m-0 mb-3 text-[16px] font-medium leading-6">
          <InlineText text={question.prompt} />
        </p>
        {review && question.id ? (
          <InteractiveAnswer question={{ ...question, id: question.id }} review={review} context={context} />
        ) : (
          <>
            <StaticOptions options={question.options} />
            {context}
          </>
        )}
      </div>
    </section>
  );
}
