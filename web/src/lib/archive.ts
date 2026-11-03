import type { DocArchive } from "@timthink/server";
import { useLocalFlag } from "./localSetting";

const ACTIVE: DocArchive = { state: "active" };
const SHOW_ARCHIVED_KEY = "timthink-show-archived";

interface MaybeArchived {
  path: string;
  archive?: DocArchive;
}

export function archiveOf(doc: MaybeArchived): DocArchive {
  return doc.archive ?? ACTIVE;
}

export function isArchived(doc: MaybeArchived): boolean {
  return archiveOf(doc).state !== "active";
}

export function partitionArchived<T extends MaybeArchived>(docs: readonly T[]): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const doc of docs) (isArchived(doc) ? archived : active).push(doc);
  return { active, archived };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function archiveSummary(archive: DocArchive): string {
  if (archive.state === "manual") return archive.reason ?? "Archived by you";
  return archive.reason ? `Archived · ${lowerFirst(archive.reason)}` : "Archived";
}

export function useShowArchived(): [boolean, (value: boolean) => void] {
  return useLocalFlag(SHOW_ARCHIVED_KEY);
}
