import { Archive, Ellipsis, RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";
import { useDismiss } from "../lib/useDismiss";
import type { PlanArchive } from "./usePlanArchive";

export function PlanOverflowMenu({ plan }: { plan: PlanArchive }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const containerRef = useDismiss<HTMLDivElement>(open, close);
  const choose = (action: () => void) => {
    action();
    setOpen(false);
  };
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More actions"
        className={`grid size-8 place-items-center rounded-button border transition-colors duration-150 ${
          open ? "border-line bg-bg-sunken text-ink" : "border-line-soft text-ink-64 hover:border-line hover:text-ink"
        }`}
      >
        <Ellipsis className="size-4" strokeWidth={2} aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Plan actions"
          className="popover-enter popover-enter-right absolute top-full right-0 z-30 mt-2 w-56 overflow-hidden rounded-card border border-line bg-surface-raised p-1 shadow-pop"
        >
          <button
            type="button"
            role="menuitem"
            disabled={plan.pending}
            onClick={() => choose(plan.archived ? plan.restorePlan : plan.archivePlan)}
            className="flex h-9 w-full items-center gap-2.5 rounded-button px-3 text-left text-ui text-ink transition-colors duration-150 hover:bg-bg-sunken disabled:opacity-50"
          >
            {plan.archived ? (
              <RotateCcw className="size-4 text-ink-64" strokeWidth={1.75} aria-hidden />
            ) : (
              <Archive className="size-4 text-ink-64" strokeWidth={1.75} aria-hidden />
            )}
            <span className="flex-1">{plan.archived ? "Restore" : "Archive"}</span>
            <kbd className="rounded-chip border border-line px-1.5 font-sans text-meta text-ink-32">E</kbd>
          </button>
        </div>
      ) : null}
    </div>
  );
}
