import { Archive, RotateCcw } from "lucide-react";
import { Button } from "../components/Button";
import { archiveSummary } from "../lib/archive";
import type { PlanArchive } from "./usePlanArchive";

export function ArchiveBanner({ plan }: { plan: PlanArchive }) {
  if (!plan.archived) return null;
  return (
    <section
      aria-label="Archived plan"
      className="mx-auto mb-4 flex max-w-[var(--paper-max)] items-center gap-3 rounded-card border border-line-soft bg-bg-sunken py-2 pr-2 pl-4"
    >
      <Archive className="size-3.5 flex-none text-ink-32" strokeWidth={1.75} aria-hidden />
      <p className="m-0 min-w-0 flex-1 truncate text-ui text-ink-64">{archiveSummary(plan.archive)}</p>
      <Button
        tone="ghost"
        icon={<RotateCcw className="size-3.5" aria-hidden />}
        disabled={plan.pending}
        onClick={plan.restorePlan}
        title="Keep this plan active (e)"
      >
        Restore
      </Button>
    </section>
  );
}
