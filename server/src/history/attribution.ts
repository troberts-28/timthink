export type Attribution =
  | { kind: "claude"; sessionId: string; sessionTitle: string }
  | { kind: "human"; name: string }
  | { kind: "unknown" };

export const UNKNOWN_AUTHOR: Attribution = { kind: "unknown" };

export interface SnapshotView {
  id: string;
  at: string;
  shortHash: string;
  attribution: Attribution;
}
