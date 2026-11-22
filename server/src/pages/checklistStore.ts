import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ProjectRecord } from "../projects/registry.js";
import { ReadOnlyError } from "../readOnly.js";
import { writeFileAtomic } from "../reviews/atomicWrite.js";
import { withFileLock } from "../reviews/fileLock.js";

export const CHECKLIST_ID_PATTERN = /^[\w.-]{1,128}$/;
export const MAX_STEP_NOTE_LENGTH = 4_000;

export const stepResultSchema = z.object({
  outcome: z.enum(["pass", "fail"]),
  note: z.string().max(MAX_STEP_NOTE_LENGTH),
  at: z.string(),
  sha: z.string().nullable(),
});

const checklistFileSchema = z.object({ steps: z.record(z.string(), stepResultSchema) });

export type StepResult = z.infer<typeof stepResultSchema>;
export type ChecklistResults = z.infer<typeof checklistFileSchema>;

export interface StepRecord {
  project: ProjectRecord;
  checklistId: string;
  stepId: string;
  result: StepResult | null;
}

export class ChecklistStore {
  constructor(
    private readonly docsRoot: string,
    private readonly readOnly: boolean,
  ) {}

  async read(project: ProjectRecord, checklistId: string): Promise<ChecklistResults> {
    const text = await readFile(this.filePath(project, checklistId), "utf8").catch(() => null);
    const parsed = checklistFileSchema.safeParse(text === null ? null : parseJson(text));
    return parsed.success ? parsed.data : { steps: {} };
  }

  async record({ project, checklistId, stepId, result }: StepRecord): Promise<ChecklistResults> {
    if (this.readOnly) {
      throw new ReadOnlyError();
    }
    const file = this.filePath(project, checklistId);
    await mkdir(path.dirname(file), { recursive: true });
    return withFileLock(`${file}.lock`, async () => {
      const { steps } = await this.read(project, checklistId);
      const { [stepId]: _replaced, ...others } = steps;
      const updated = { steps: result ? { ...others, [stepId]: result } : others };
      await writeFileAtomic(file, `${JSON.stringify(updated, null, 2)}\n`);
      return updated;
    });
  }

  private filePath(project: ProjectRecord, checklistId: string) {
    const top = project.area ?? project.id;
    return path.join(this.docsRoot, top, ".timthink", "checklists", project.slug, `${checklistId}.json`);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
