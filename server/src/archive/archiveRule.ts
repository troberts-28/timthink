import type { DocArchive } from "../docs/types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SETTLED_PROJECT_STATUSES: ReadonlySet<string> = new Set(["shipped", "dropped"]);

export type ManualArchive = { kind: "archived"; at: string } | { kind: "keep-active"; at: string } | null;

export interface ArchiveRuleInput {
  manual: ManualArchive;
  projectStatus: string | null;
  now: number;
}

export const ACTIVE: DocArchive = { state: "active" };

export function archiveState(input: ArchiveRuleInput): DocArchive {
  if (input.manual?.kind === "archived") {
    return { state: "manual", reason: `Archived by you ${daysAgo(input.now - Date.parse(input.manual.at))}` };
  }
  if (input.manual?.kind === "keep-active") {
    return ACTIVE;
  }
  if (input.projectStatus && SETTLED_PROJECT_STATUSES.has(input.projectStatus)) {
    return { state: "auto", reason: `Project ${input.projectStatus}` };
  }
  return ACTIVE;
}

function daysAgo(ms: number) {
  const days = Math.max(0, Math.floor(ms / DAY_MS));
  if (days === 0) {
    return "today";
  }
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
