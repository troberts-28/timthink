import { ChevronRight } from "lucide-react";
import { type ReactNode, useId, useLayoutEffect, useRef } from "react";

interface QuestionContextProps {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function QuestionContext({ open, onToggle, children }: QuestionContextProps) {
  const panelId = useId();
  const innerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (innerRef.current) innerRef.current.inert = !open;
  }, [open]);
  return (
    <div className="question-context">
      <button
        type="button"
        className="question-context-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <ChevronRight className="question-context-chevron size-3.5" aria-hidden />
        More context
      </button>
      <div id={panelId} className="question-context-panel" data-open={open}>
        <div ref={innerRef} className="question-context-clip">
          <div className="question-details">{children}</div>
        </div>
      </div>
    </div>
  );
}
