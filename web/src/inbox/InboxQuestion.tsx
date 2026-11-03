import type { InboxDoc, InboxQuestion as InboxQuestionData } from "@timthink/server";
import { useMemo, useState } from "react";
import { useDocsIndex } from "../api/queries";
import { findRepo } from "../lib/indexNav";
import { InlineText } from "../markdown/InlineText";
import { MarkdownElement } from "../markdown/Markdown";
import { PlanContext } from "../markdown/PlanContext";
import { OptionText } from "../markdown/QuestionCard";
import { QuestionContext } from "../markdown/QuestionContext";
import { questionDetailsHast } from "../markdown/questionDetails";
import { useAutoLinkOptions } from "../plan/useRenderedMarkdown";

function DetailsMarkdown({ markdown, doc }: { markdown: string; doc: InboxDoc }) {
  const { data: index } = useDocsIndex();
  const options = useAutoLinkOptions(doc.path, findRepo(index, doc.repo), index);
  const element = useMemo(() => questionDetailsHast(markdown, options, null), [markdown, options]);
  return (
    <PlanContext.Provider value={{ repo: doc.repo, docPath: doc.path }}>
      <MarkdownElement element={element} />
    </PlanContext.Provider>
  );
}

export function InboxQuestion({ question, doc }: { question: InboxQuestionData; doc: InboxDoc }) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const toggle = () => {
    setOpened(true);
    setOpen((value) => !value);
  };
  return (
    <div className="relative z-10 mt-1.5 max-w-[680px]">
      <p className="m-0 text-ui text-ink">
        <InlineText text={question.prompt} />
      </p>
      {question.options.length > 0 ? (
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0" aria-label="Options">
          {question.options.map((option) => (
            <li key={option.label} className="inbox-question-option">
              <span className="mt-[7px] size-1.5 flex-none rounded-full bg-ink-32" aria-hidden />
              <OptionText option={option} />
            </li>
          ))}
        </ul>
      ) : null}
      {question.details ? (
        <div className="plan-body inbox-question-context">
          <QuestionContext open={open} onToggle={toggle}>
            {opened ? <DetailsMarkdown markdown={question.details} doc={doc} /> : null}
          </QuestionContext>
        </div>
      ) : null}
    </div>
  );
}
