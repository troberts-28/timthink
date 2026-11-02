import type { ReviewView, Thread } from "@timthink/server";
import { byDocumentOrder } from "./reviewModel";

export interface ThreadGroups {
  placed: Thread[];
  unplaced: Thread[];
  resolvedCount: number;
}

export function groupThreads(
  review: ReviewView | undefined,
  ranges: ReadonlyMap<string, Range>,
  showResolved: boolean,
): ThreadGroups {
  const threads = [...(review?.threads ?? [])].sort(byDocumentOrder);
  const visible = threads.filter((thread) => thread.status !== "resolved" || showResolved);
  return {
    placed: visible.filter((thread) => thread.status !== "outdated" && ranges.has(thread.id)),
    unplaced: visible.filter((thread) => thread.status === "outdated" || !ranges.has(thread.id)),
    resolvedCount: threads.filter((thread) => thread.status === "resolved").length,
  };
}
