import { ChevronDown, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { pluralise } from "../lib/format";
import { useRequiredReview } from "./ReviewContext";

interface ThreadPanelHeaderProps {
  openCount: number;
  resolvedCount: number;
  trailing?: ReactNode;
}

export function ThreadPanelHeader({ openCount, resolvedCount, trailing }: ThreadPanelHeaderProps) {
  const { showResolved, setShowResolved } = useRequiredReview();
  return (
    <div className="flex items-center gap-2">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-64">
        {openCount > 0 ? pluralise(openCount, "open thread") : "No open threads"}
      </p>
      {resolvedCount > 0 ? (
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-meta text-ink-64 hover:text-ink">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(event) => setShowResolved(event.target.checked)}
            className="toggle"
          />
          Show resolved ({resolvedCount})
        </label>
      ) : null}
      {trailing}
    </div>
  );
}

export function OutdatedGroup({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  if (count === 0) return null;
  return (
    <section className="rounded-card border border-dashed border-line bg-bg-sunken/50 p-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-[8px] px-1.5 py-1 text-left text-meta font-medium text-ink-64 hover:text-ink"
      >
        <TriangleAlert className="size-3.5 flex-none" aria-hidden />
        <span className="whitespace-nowrap">Outdated ({count})</span>
        <span className="min-w-0 truncate font-normal text-ink-32">their text changed</span>
        <ChevronDown
          className={`ml-auto size-3.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? <div className="mt-2 flex flex-col gap-2">{children}</div> : null}
    </section>
  );
}
