import { readFile } from "node:fs/promises";
import { canonicalStatus } from "../docs/status.js";
import type { DocSummary } from "../docs/types.js";
import { ALL_PRS_MERGED, TIMTHINK_ACTOR } from "../history/attribution.js";
import { writeFileAtomic } from "../reviews/atomicWrite.js";
import { setFrontmatterStatus } from "../reviews/frontmatterStatus.js";
import type { HubDocWrite } from "../reviews/reviewService.js";
import { resolveInsideRoot } from "../safePath.js";

const FINISHED: ReadonlySet<string> = new Set(["done", "abandoned"]);

export interface CompletionDeps {
  docsRoot: string;
  readOnly: boolean;
  docs: { getDoc(docPath: string): DocSummary | undefined };
  prs: {
    completionMarker(doc: DocSummary): string | null;
    markCompleted(docPath: string, marker: string): Promise<void>;
  };
  onDocWrite: (write: HubDocWrite) => void;
  log?: (message: string) => void;
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
      const before = await readFile(absolute, "utf8");
      const after = setFrontmatterStatus(before, "done");
      if (after !== before) {
        deps.onDocWrite({ docPath, before, after, actorName: `${TIMTHINK_ACTOR}:${ALL_PRS_MERGED}` });
        await writeFileAtomic(absolute, after);
        deps.log?.(`marked ${docPath} done: all PRs merged`);
      }
    } catch (error) {
      deps.log?.(`couldn't mark ${docPath} done: ${error instanceof Error ? error.message : String(error)}`);
    }
    await deps.prs.markCompleted(docPath, marker);
  }
}
