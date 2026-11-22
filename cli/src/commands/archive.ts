import {
  type ArchiveAction,
  type IndexedDoc,
  type OfflineArchiveConfig,
  openArchive,
  ReadOnlyError,
} from "@timthink/server";
import { resolveDocArgument } from "./review.js";
import { DocOutsideRootError } from "./url.js";

export const ARCHIVE_USAGE = `Usage:
  timthink archive <doc>                      Archive a plan: hide it from the sidebar and inbox
  timthink unarchive <doc>                    Keep a plan active, even when its project is shipped or dropped
  timthink archive --clear <doc>              Forget a manual archive or keep-active choice
  timthink archive --list [--repo name]       List archived plans and why

<doc> may be absolute, ~-relative, or relative to docsRoot.`;

export interface ArchiveOptions {
  list?: boolean;
  clear?: boolean;
  repo?: string;
}

export interface ArchiveIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

const ACTION_MESSAGES: Record<ArchiveAction, (docPath: string) => string> = {
  archive: (docPath) => `Archived ${docPath}.`,
  "keep-active": (docPath) => `Kept ${docPath} active.`,
  clear: (docPath) => `Cleared the archive choice for ${docPath}.`,
};

function byRepo(docs: readonly IndexedDoc[]): Map<string, IndexedDoc[]> {
  const repos = new Map<string, IndexedDoc[]>();
  for (const doc of [...docs].sort((a, b) => a.repo.localeCompare(b.repo) || a.relPath.localeCompare(b.relPath))) {
    repos.set(doc.repo, [...(repos.get(doc.repo) ?? []), doc]);
  }
  return repos;
}

function docLine(doc: IndexedDoc): string {
  return `  ${doc.relPath}\t${doc.archive.reason ?? ""}`;
}

async function indexedDocs(config: OfflineArchiveConfig, repo: string | undefined): Promise<IndexedDoc[]> {
  const { docs, archive } = await openArchive({ ...config, readOnly: true });
  return docs
    .allDocs()
    .filter((doc) => !repo || doc.repo === repo)
    .map((doc) => ({ ...doc, archive: archive.stateFor(doc), prAttention: null }));
}

async function list(config: OfflineArchiveConfig, options: ArchiveOptions, io: ArchiveIo): Promise<number> {
  const archived = (await indexedDocs(config, options.repo)).filter((doc) => doc.archive.state !== "active");
  if (archived.length === 0) {
    io.out("No archived plans.");
    return 0;
  }
  for (const [repo, docs] of byRepo(archived)) {
    io.out(`${repo} (${docs.length} archived)`);
    for (const doc of docs) io.out(docLine(doc));
  }
  return 0;
}

async function apply(
  config: OfflineArchiveConfig,
  input: string,
  action: ArchiveAction,
  io: ArchiveIo,
): Promise<number> {
  const docPath = await resolveDocArgument(config.docsRoot, input);
  const { docs, archive } = await openArchive(config);
  const doc = docs.getDoc(docPath);
  if (!doc) {
    io.err(`No plan at ${docPath}`);
    return 1;
  }
  await archive.apply(docPath, action);
  const state = archive.stateFor(doc);
  const suffix = state.state === "auto" ? ` (still archived: ${state.reason ?? ""})` : "";
  io.out(`${ACTION_MESSAGES[action](docPath)}${suffix}`);
  return 0;
}

export async function runArchive(
  config: OfflineArchiveConfig,
  command: "archive" | "unarchive",
  args: readonly string[],
  options: ArchiveOptions,
  io: ArchiveIo,
): Promise<number> {
  try {
    if (command === "archive" && options.list) return await list(config, options, io);
    const [docArg] = args;
    if (!docArg) {
      io.err(ARCHIVE_USAGE);
      return 1;
    }
    const action: ArchiveAction = command === "unarchive" ? "keep-active" : options.clear ? "clear" : "archive";
    return await apply(config, docArg, action, io);
  } catch (error) {
    if (error instanceof DocOutsideRootError || error instanceof ReadOnlyError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}
