import type { Attribution } from "../history/attribution.js";
import type { QuestionOption } from "../markdown/questionBlock.js";

export type InboxSection = "review" | "replies" | "questions" | "waiting" | "changed";

export type InboxReason =
  | "review-requested"
  | "review-addressed"
  | "claude-replied"
  | "open-question"
  | "waiting-on-claude"
  | "edited"
  | "new";

export interface InboxDoc {
  path: string;
  repo: string;
  project: string | null;
  title: string;
  status: string | null;
  hash: string;
}

export interface InboxSessionHint {
  id: string;
  title: string;
  live: boolean;
  canFocus: boolean;
  canResume: boolean;
}

export interface InboxQuestion {
  prompt: string;
  options: QuestionOption[];
  details: string | null;
}

export interface InboxItem {
  id: string;
  section: InboxSection;
  reason: InboxReason;
  doc: InboxDoc;
  at: string;
  detail: string | null;
  count: number;
  questionId: string | null;
  question: InboxQuestion | null;
  attribution: Attribution | null;
  session: InboxSessionHint | null;
}

export interface InboxAttention {
  total: number;
  byRepo: Record<string, number>;
}

export interface InboxResponse {
  generatedAt: string;
  items: InboxItem[];
  attention: InboxAttention;
}
