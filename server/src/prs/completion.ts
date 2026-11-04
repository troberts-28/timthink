import { readFile } from "node:fs/promises";
import { canonicalStatus } from "../docs/status.js";
import { linesOutsideFences } from "../docs/summarize.js";
import type { DocSummary } from "../docs/types.js";
import { parseFrontmatter } from "../frontmatter.js";
import { ALL_PRS_MERGED, TIMTHINK_ACTOR } from "../history/attribution.js";
import { writeFileAtomic } from "../reviews/atomicWrite.js";
import { setFrontmatterStatus } from "../reviews/frontmatterStatus.js";
import type { HubDocWrite } from "../reviews/reviewService.js";
import { resolveInsideRoot } from "../safePath.js";

const FINISHED: ReadonlySet<string> = new Set(["done", "abandoned"]);
const OPEN_TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s(.*)$/;
const PR_MENTIONS = [/#(\d+)\b/g, /\/pull\/(\d+)\b/g, /\/github\/pr\/[\w.-]+\/[\w.-]+\/(\d+)\b/g];

export interface CompletionDeps {
  docsRoot: string;
  readOnly: boolean;
  docs: { getDoc(docPath: string): DocSummary | undefined };
  prs: {
    completionMarker(doc: DocSummary): string | null;
    markCompleted(docPath: string, marker: string): Promise<void>;
    markAwaiting(docPath: string, marker: string, openTasks: number): Promise<void>;
  };
  onDocWrite: (write: HubDocWrite) => void;
  log?: (message: string) => void;
}

export function openTasksNotCovered(body: string, mergedPrs: ReadonlySet<number>): number {
  let open = 0;
  for (const line of linesOutsideFences(body)) {
    const task = OPEN_TASK.exec(line)?.[1];
    if (task === undefined) continue;
    const mentioned = PR_MENTIONS.flatMap((pattern) => [...task.matchAll(pattern)].map((match) => Number(match[1])));
    if (!mentioned.some((number) => mergedPrs.has(number))) open += 1;
  }
  return open;
}

export async function markPlanDone(docPath: string, deps: CompletionDeps): Promise<boolean> {
  const absolute = await resolveInsideRoot(deps.docsRoot, docPath);
  const before = await readFile(absolute, "utf8");
  const after = setFrontmatterStatus(before, "done");
  if (after === before) return false;
  deps.onDocWrite({ docPath, before, after, actorName: `${TIMTHINK_ACTOR}:${ALL_PRS_MERGED}` });
  await writeFileAtomic(absolute, after);
  return true;
}

export async function completePlansWithMergedPrs(paths: readonly string[], deps: CompletionDeps): Promise<void> {
  if (deps.readOnly) return;
  for (const docPath of paths) {
    const doc = deps.docs.getDoc(docPath);
    if (!doc || FINISHED.has(canonicalStatus(doc.status) ?? "")) continue;
    const marker = deps.prs.completionMarker(doc);
    if (!marker) continue;
    try {
      const absolute = await resolveInsideRoot(deps.docsRoot, docPath);
      const { body } = parseFrontmatter(await readFile(absolute, "utf8"));
      const openTasks = openTasksNotCovered(body, new Set(marker.split(",").map(Number)));
      if (openTasks > 0) {
        await deps.prs.markAwaiting(docPath, marker, openTasks);
        continue;
      }
      if (await markPlanDone(docPath, deps)) deps.log?.(`marked ${docPath} done: all PRs merged`);
    } catch (error) {
      deps.log?.(`couldn't mark ${docPath} done: ${error instanceof Error ? error.message : String(error)}`);
    }
    await deps.prs.markCompleted(docPath, marker);
  }
}
