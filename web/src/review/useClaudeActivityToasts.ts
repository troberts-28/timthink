import type { ReviewView } from "@timthink/server";
import { useEffect, useRef } from "react";
import { pluralise } from "../lib/format";
import { useToast } from "../lib/toast";
import { claudeActivity, excerpt } from "./reviewModel";

const QUOTE_LENGTH = 40;

export function useClaudeActivityToasts(review: ReviewView | undefined): void {
  const toast = useToast();
  const previous = useRef<ReviewView | undefined>(undefined);
  useEffect(() => {
    const before = previous.current;
    previous.current = review;
    if (!before || !review || before.doc !== review.doc || before.version === review.version) return;
    const activity = claudeActivity(before, review);
    const [onlyReply] = activity.replies;
    if (activity.replies.length === 1 && onlyReply) {
      toast(`Claude replied on “${excerpt(onlyReply.anchor.quote, QUOTE_LENGTH)}”`);
    } else if (activity.replies.length > 1) {
      toast(`Claude replied on ${pluralise(activity.replies.length, "thread")}`);
    }
    if (activity.resolved.length > 0 && activity.replies.length === 0) {
      toast(`Claude resolved ${pluralise(activity.resolved.length, "thread")}`);
    }
    if (activity.addressed) toast("Claude has addressed your review");
  }, [review, toast]);
}
