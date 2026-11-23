import type { InboxDoc, InboxQuestion as InboxQuestionData } from "@timthink/server";
import { Send } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useDoc, useDocsIndex } from "../api/queries";
import { Button } from "../components/Button";
import { pluralise } from "../lib/format";
import { findDoc } from "../lib/indexNav";
import { InlineText } from "../markdown/InlineText";
import { MarkdownElement } from "../markdown/Markdown";
import { PlanContext } from "../markdown/PlanContext";
import { InteractiveAnswer, OptionText } from "../markdown/QuestionCard";
import { QuestionContext } from "../markdown/QuestionContext";
import { questionDetailsHast } from "../markdown/questionDetails";
import { useAutoLinkOptions } from "../plan/useRenderedMarkdown";
import { ReviewProvider, useRequiredReview } from "../review/ReviewContext";
import { useSendReview } from "../review/useSendReview";

function DetailsMarkdown({ markdown, doc }: { markdown: string; doc: InboxDoc }) {
  const { data: index } = useDocsIndex();
  const summary = findDoc(index, doc.path);
  const options = useAutoLinkOptions(summary, index);
  const element = useMemo(() => questionDetailsHast(markdown, options, null), [markdown, options]);
  return (
    <PlanContext.Provider value={{ repo: summary?.codeRepo ?? doc.repo, docPath: doc.path }}>
      <MarkdownElement element={element} />
    </PlanContext.Provider>
  );
}

interface InboxQuestionProps {
  questionId: string;
  question: InboxQuestionData;
  doc: InboxDoc;
}

export function InboxQuestion({ questionId, question, doc }: InboxQuestionProps) {
  const { data: detail } = useDoc(doc.path);
  const context = question.details ? <QuestionDetailsToggle markdown={question.details} doc={doc} /> : null;
  return (
    <div className="relative z-10 mt-1.5 max-w-[680px]">
      <p className="m-0 mb-2 text-ui text-ink">
        <InlineText text={question.prompt} />
      </p>
      {detail ? (
        <ReviewProvider docPath={doc.path} raw={detail.raw} docHash={detail.hash}>
          <InboxAnswer questionId={questionId} question={question} context={context} />
        </ReviewProvider>
      ) : (
        <>
          <StaticOptionList question={question} />
          {context}
        </>
      )}
    </div>
  );
}

function InboxAnswer({ questionId, question, context }: Omit<InboxQuestionProps, "doc"> & { context: ReactNode }) {
  const review = useRequiredReview();
  return (
    <>
      <InteractiveAnswer
        question={{ id: questionId, prompt: question.prompt, options: question.options, details: null }}
        review={review}
        context={context}
      />
      <SendAnswers />
    </>
  );
}

function SendAnswers() {
  const { counts, sending, send } = useSendReview();
  if (counts.total === 0) {
    return null;
  }
  const others = counts.comments + counts.replies;
  return (
    <div className="mt-2 flex items-center gap-3">
      <Button
        size="sm"
        tone="primary"
        disabled={sending}
        icon={<Send className="size-3.5" aria-hidden />}
        onClick={() => void send()}
      >
        Send {pluralise(counts.answers, "answer")} to Claude
      </Button>
      {others > 0 ? (
        <span className="text-meta text-ink-64">with {pluralise(others, "other draft comment")} on this plan</span>
      ) : null}
    </div>
  );
}

function StaticOptionList({ question }: { question: InboxQuestionData }) {
  if (question.options.length === 0) {
    return null;
  }
  return (
    <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0" aria-label="Options">
      {question.options.map((option) => (
        <li key={option.label} className="inbox-question-option">
          <span className="mt-[7px] size-1.5 flex-none rounded-full bg-ink-32" aria-hidden />
          <OptionText option={option} />
        </li>
      ))}
    </ul>
  );
}

function QuestionDetailsToggle({ markdown, doc }: { markdown: string; doc: InboxDoc }) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const toggle = () => {
    setOpened(true);
    setOpen((value) => !value);
  };
  return (
    <div className="plan-body inbox-question-context">
      <QuestionContext open={open} onToggle={toggle}>
        {opened ? <DetailsMarkdown markdown={markdown} doc={doc} /> : null}
      </QuestionContext>
    </div>
  );
}
