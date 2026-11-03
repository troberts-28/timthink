export type Attribution =
  | { kind: "claude"; sessionId: string; sessionTitle: string }
  | { kind: "human"; name: string }
  | { kind: "timthink"; reason: string }
  | { kind: "unknown" };

export const UNKNOWN_AUTHOR: Attribution = { kind: "unknown" };

export const TIMTHINK_ACTOR = "timthink";
export const ALL_PRS_MERGED = "all PRs merged";

export interface SnapshotView {
  id: string;
  at: string;
  shortHash: string;
  attribution: Attribution;
}
