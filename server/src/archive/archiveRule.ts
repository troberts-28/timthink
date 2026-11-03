import type { ArchiveSettings } from "../config.js";
import { canonicalStatus } from "../docs/status.js";
import type { DocArchive } from "../docs/types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set(["review", "in-progress"]);
const FINISHED_STATUSES: ReadonlySet<string> = new Set(["done", "abandoned"]);

export type ManualArchive = { kind: "archived"; at: string } | { kind: "keep-active"; at: string } | null;

export interface ArchiveRuleInput {
  status: string | null;
  mtime: number;
  manual: ManualArchive;
  needsUser: boolean;
  settings: ArchiveSettings;
  now: number;
}

export const ACTIVE: DocArchive = { state: "active" };

function wholeDays(ms: number): number {
  return Math.max(0, Math.floor(ms / DAY_MS));
}

function daysPhrase(days: number): string {
  if (days === 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function autoArchive(input: ArchiveRuleInput): DocArchive | null {
  const { settings, now, mtime } = input;
  if (!settings.auto || input.needsUser) return null;
  const status = canonicalStatus(input.status);
  const idleDays = wholeDays(now - mtime);
  const idleMs = now - mtime;
  if (status && IN_FLIGHT_STATUSES.has(status)) {
    if (idleMs <= settings.inFlightStaleAfterDays * DAY_MS) return null;
    return { state: "auto", reason: `${capitalise(status)} but not edited for ${idleDays} days` };
  }
  if (status && FINISHED_STATUSES.has(status) && idleMs > settings.finishedAfterDays * DAY_MS) {
    return { state: "auto", reason: `${capitalise(status)} ${daysPhrase(idleDays)}` };
  }
  if (idleMs > settings.staleAfterDays * DAY_MS) {
    return { state: "auto", reason: `Not edited for ${idleDays} days` };
  }
  return null;
}

export function archiveState(input: ArchiveRuleInput): DocArchive {
  if (input.manual?.kind === "archived") {
    return {
      state: "manual",
      reason: `Archived by you ${daysPhrase(wholeDays(input.now - Date.parse(input.manual.at)))}`,
    };
  }
  if (input.manual?.kind === "keep-active") return ACTIVE;
  return autoArchive(input) ?? ACTIVE;
}
