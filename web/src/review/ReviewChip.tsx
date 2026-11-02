import type { Review } from "@timthink/server";
import { ClipboardCheck } from "lucide-react";
import { relativeTime } from "../lib/format";
import { useRequiredReview } from "./ReviewContext";
import { latestSubmittedReview } from "./reviewModel";

const VERDICT_CHIPS: Record<NonNullable<Review["verdict"]>, { label: string; className: string }> = {
  approve: { label: "Approved", className: "chip-ok-soft" },
  request_changes: { label: "Changes requested", className: "chip-bad" },
  comment: { label: "Commented", className: "chip-neutral" },
};

export function ReviewChip() {
  const { review } = useRequiredReview();
  const latest = latestSubmittedReview(review);
  if (!latest?.verdict) return null;
  const chip = VERDICT_CHIPS[latest.verdict];
  const state = latest.state === "addressed" ? "addressed" : "waiting on Claude";
  const when = latest.state === "addressed" ? latest.addressedAt : latest.submittedAt;
  return (
    <span
      className={`chip ${chip.className}`}
      title={`Your latest review${when ? `, ${relativeTime(Date.parse(when))}` : ""}`}
    >
      <ClipboardCheck className="size-3" aria-hidden />
      {chip.label}
      <span className="opacity-70">· {state}</span>
    </span>
  );
}

export function ReviewButton() {
  const { setSubmitOpen } = useRequiredReview();
  return (
    <button
      type="button"
      onClick={() => setSubmitOpen(true)}
      className="flex h-8 items-center gap-2 rounded-button border border-line-soft px-3 text-meta font-medium text-ink-64 transition-colors duration-150 hover:border-line hover:text-ink"
    >
      <ClipboardCheck className="size-3.5" strokeWidth={2} aria-hidden />
      Review
    </button>
  );
}
