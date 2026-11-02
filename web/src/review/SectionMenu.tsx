import { Ellipsis, MessageSquarePlus } from "lucide-react";
import { useCallback, useState } from "react";
import { useDismiss } from "../lib/useDismiss";
import { useReviewContext } from "./ReviewContext";

export function SectionMenu({ start, end }: { start: number; end: number }) {
  const review = useReviewContext();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const containerRef = useDismiss<HTMLSpanElement>(open, close);
  if (!review || end <= start) return null;
  return (
    <span ref={containerRef} className={`section-menu ${open ? "is-open" : ""}`} contentEditable={false}>
      <button
        type="button"
        className="section-menu-button"
        aria-label="Section actions"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Ellipsis className="size-4" aria-hidden />
      </button>
      {open ? (
        <span
          role="menu"
          className="popover-enter absolute top-full left-0 z-30 mt-1 flex w-max flex-col rounded-button border border-line bg-surface-raised p-1 shadow-pop"
        >
          <button
            type="button"
            role="menuitem"
            className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-ui font-normal text-ink hover:bg-bg-sunken"
            onClick={() => {
              close();
              review.openComposer({ kind: "comment", start, end });
            }}
          >
            <MessageSquarePlus className="size-3.5 text-ink-64" aria-hidden />
            Comment on section
          </button>
        </span>
      ) : null}
    </span>
  );
}
