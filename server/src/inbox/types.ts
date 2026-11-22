import type { QuestionOption } from "../markdown/questionBlock.js";
import type { RoundSummary } from "../rounds/roundView.js";

export interface InboxDoc {
  path: string;
  repo: string;
  project: string | null;
  title: string;
  status: string | null;
  hash: string;
}

export interface InboxQuestion {
  prompt: string;
  options: QuestionOption[];
  details: string | null;
}

export interface InboxQuestionItem {
  kind: "question";
  id: string;
  at: string;
  repo: string;
  doc: InboxDoc;
  questionId: string;
  question: InboxQuestion;
}

export interface InboxRoundItem {
  kind: "round";
  id: string;
  at: string;
  repo: string;
  round: RoundSummary;
}

export type InboxItem = InboxQuestionItem | InboxRoundItem;

export interface InboxAttention {
  total: number;
  byRepo: Record<string, number>;
}

export interface InboxResponse {
  generatedAt: string;
  items: InboxItem[];
  attention: InboxAttention;
}
