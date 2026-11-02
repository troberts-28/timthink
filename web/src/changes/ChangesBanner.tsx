import { Check, Eye, EyeOff, History } from "lucide-react";
import { Button } from "../components/Button";
import { pluralise, relativeTime } from "../lib/format";
import { bySummary } from "./attribution";
import { useChanges } from "./ChangesContext";

function changeCount(blockCount: number, metadataChanged: boolean): string {
  if (blockCount === 0) return metadataChanged ? "Properties changed" : "No visible changes";
  const blocks = `${pluralise(blockCount, "block")} changed`;
  return metadataChanged ? `${blocks}, plus properties` : blocks;
}

function shortDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function ChangesBanner() {
  const changes = useChanges();
  if (!changes?.hasChanges || !changes.baseline) return null;
  const { latestChange, diff, comparingHistory, baseline, showChanges, setShowChanges } = changes;
  const title = comparingHistory ? `Changes since ${shortDateTime(baseline.at)}` : "Changed since you last looked";
  const parts = [
    latestChange ? bySummary(latestChange.attribution) : null,
    latestChange ? relativeTime(Date.parse(latestChange.at)) : null,
    diff ? changeCount(diff.blockCount, diff.metadataChanged) : null,
  ].filter((part): part is string => part !== null);

  return (
    <section
      aria-label="Changes since you last looked"
      className="changes-banner popover-enter mx-auto mb-4 flex max-w-[760px] flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-surface py-2.5 pr-2.5 pl-4"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className="grid size-7 flex-none place-items-center rounded-full bg-accent-soft text-accent-ink"
          aria-hidden
        >
          <History className="size-3.5" strokeWidth={2.25} />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-ui font-semibold text-ink">{title}</p>
          {parts.length > 0 ? (
            <p className="m-0 mt-0.5 truncate text-meta text-ink-64" title={parts.join(" · ")}>
              {parts.join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-none items-center gap-2">
        {comparingHistory ? (
          <Button tone="ghost" onClick={() => changes.showInlineSince(null)}>
            Back to last seen
          </Button>
        ) : null}
        <Button
          tone={showChanges ? "primary" : "secondary"}
          aria-pressed={showChanges}
          disabled={!diff}
          icon={showChanges ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
          onClick={() => setShowChanges(!showChanges)}
        >
          {showChanges ? "Hide changes" : "Show changes"}
        </Button>
        <Button icon={<Check className="size-3.5" aria-hidden />} onClick={changes.markAsSeen}>
          Mark as seen
        </Button>
      </div>
    </section>
  );
}
