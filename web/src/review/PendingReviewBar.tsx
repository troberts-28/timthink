import { Send } from "lucide-react";
import { Button } from "../components/Button";
import { pluralise } from "../lib/format";
import { useRequiredReview } from "./ReviewContext";
import { pendingCounts } from "./reviewModel";

function summary(counts: ReturnType<typeof pendingCounts>): string {
  const parts: string[] = [];
  if (counts.comments > 0) parts.push(pluralise(counts.comments, "draft comment"));
  if (counts.replies > 0) parts.push(pluralise(counts.replies, "draft reply", "draft replies"));
  if (counts.answers > 0) parts.push(pluralise(counts.answers, "answer"));
  return parts.join(" · ");
}

export function PendingReviewBar() {
  const { review, setSubmitOpen } = useRequiredReview();
  const counts = pendingCounts(review);
  if (counts.total === 0) return null;
  return (
    <div className="pending-bar sticky bottom-5 z-20 mx-auto mt-6 flex max-w-[760px] items-center gap-3 rounded-card border border-line bg-surface-raised py-2.5 pr-2.5 pl-4 shadow-pop">
      <span className="size-2 flex-none rounded-full bg-accent" aria-hidden />
      <p className="m-0 min-w-0 flex-1 truncate text-ui font-medium text-ink">{summary(counts)}</p>
      <span className="hidden text-meta text-ink-32 sm:inline">Nothing reaches Claude until you submit</span>
      <Button tone="primary" icon={<Send className="size-3.5" aria-hidden />} onClick={() => setSubmitOpen(true)}>
        Submit review
      </Button>
    </div>
  );
}
