import type { DocKind } from "../docs/types.js";
import type { ChecklistResults } from "../pages/checklistStore.js";
import type { ProjectDetail } from "../projects/projectView.js";

export const EXPORT_DATA_ELEMENT_ID = "timthink-export";

export interface ExportDoc {
  path: string;
  title: string;
  kind: DocKind;
  codeRepo: string;
  status: string | null;
  date: string | null;
  raw: string;
}

export interface ProjectExport {
  detail: ProjectDetail;
  pagePath: string;
  docs: ExportDoc[];
  checklists: Record<string, ChecklistResults>;
  publishedAt: string;
  expiresAt: string;
}
