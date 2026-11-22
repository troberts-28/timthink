import type { DocsStore } from "../docs/store.js";
import type { DocSummary } from "../docs/types.js";
import type { ReviewStore } from "../reviews/reviewStore.js";
import type { RoundStore } from "../rounds/roundStore.js";
import { summarizeRound } from "../rounds/roundView.js";
import { buildInbox, type InboxDocInput } from "./buildInbox.js";
import type { InboxResponse } from "./types.js";

export interface InboxServiceDeps {
  store: DocsStore;
  reviews: ReviewStore;
  rounds: RoundStore;
  isArchived?: (summary: DocSummary) => boolean;
  now?: () => Date;
}

export class InboxService {
  constructor(private readonly deps: InboxServiceDeps) {}

  async build(): Promise<InboxResponse> {
    const reviewed = new Set(await this.deps.reviews.docsWithReviews());
    const [docs, rounds] = await Promise.all([
      Promise.all(this.deps.store.allDocs().map((summary) => this.docInput(summary, reviewed.has(summary.path)))),
      this.deps.rounds.list(),
    ]);
    return buildInbox({
      docs: docs.filter((doc) => doc !== null),
      rounds: rounds.map(summarizeRound),
      now: this.deps.now?.() ?? new Date(),
    });
  }

  private async docInput(summary: DocSummary, hasReview: boolean): Promise<InboxDocInput | null> {
    const content = this.deps.store.contentOf(summary.path);
    if (!content || content.questions.length === 0) {
      return null;
    }
    return {
      summary,
      archived: this.deps.isArchived?.(summary) ?? false,
      hash: content.hash,
      questions: content.questions,
      review: hasReview ? await this.deps.reviews.read(summary.path).catch(() => null) : null,
    };
  }
}
