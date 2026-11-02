import type { Attribution } from "@timthink/server";

export function authorName(attribution: Attribution): string {
  if (attribution.kind === "claude") return "Claude";
  if (attribution.kind === "human") return "You";
  return "Edited outside the hub";
}

export function bySummary(attribution: Attribution): string {
  if (attribution.kind === "claude") return `by Claude (“${attribution.sessionTitle}”)`;
  if (attribution.kind === "human") return "by you";
  return "edited outside the hub";
}
