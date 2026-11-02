import type { DocsStore } from "../docs/store.js";
import type { DocSummary } from "../docs/types.js";
import type { HistoryService } from "../history/historyService.js";
import { shortHash } from "../history/snapshotStore.js";
import { unaddressedReviews } from "../reviews/operations.js";
import type { ReviewStore } from "../reviews/reviewStore.js";
import type { ReviewFile } from "../reviews/schema.js";
import type { SeenEntry, SeenStore } from "../seen/seenStore.js";
import type { SessionStore } from "../sessions/sessionStore.js";
import { isExistingDirectory, isSessionId, isWarpFocusUrl } from "../sessions/warp.js";
import { buildInbox, CHANGED_WINDOW_DAYS, type InboxDocInput, type LatestChange } from "./buildInbox.js";
import type { InboxResponse, InboxSessionHint } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InboxServiceDeps {
  store: DocsStore;
  reviews: ReviewStore;
  seen: SeenStore;
  history: HistoryService;
  sessions: SessionStore;
  now?: () => Date;
}

export class InboxService {
  constructor(private readonly deps: InboxServiceDeps) {}

  async build(): Promise<InboxResponse> {
    const now = this.deps.now?.() ?? new Date();
    const reviewed = new Set(await this.deps.reviews.docsWithReviews());
    const docs = await Promise.all(
      this.deps.store.allDocs().map((summary) => this.docInput(summary, reviewed.has(summary.path), now)),
    );
    return buildInbox({
      docs: docs.filter((doc) => doc !== null),
      seenInitialisedAt: this.deps.seen.initialisedAt,
      threadReadAt: (docPath, threadId) => this.deps.seen.threadReadAt(docPath, threadId),
      now,
    });
  }

  private async docInput(summary: DocSummary, hasReview: boolean, now: Date): Promise<InboxDocInput | null> {
    const content = this.deps.store.contentOf(summary.path);
    if (!content) return null;
    const review = hasReview ? await this.deps.reviews.read(summary.path).catch(() => null) : null;
    const seen = this.deps.seen.get(summary.path);
    const latestChange = this.mayHaveChanged(summary, content.hash, seen, now)
      ? await this.latestChange(summary, content.hash)
      : null;
    return {
      summary,
      hash: content.hash,
      questions: content.questions,
      review,
      seen,
      latestChange,
      session: await this.sessionHint(summary.path, review),
    };
  }

  private mayHaveChanged(summary: DocSummary, hash: string, seen: SeenEntry | null, now: Date): boolean {
    if (now.getTime() - summary.mtime > CHANGED_WINDOW_DAYS * DAY_MS) return false;
    return seen ? seen.hash !== hash : new Date(summary.mtime).toISOString() > this.deps.seen.initialisedAt;
  }

  private async latestChange(summary: DocSummary, hash: string): Promise<LatestChange> {
    const [latest] = await this.deps.history.list(summary.path);
    if (latest && latest.shortHash === shortHash(hash)) return { at: latest.at, attribution: latest.attribution };
    return { at: new Date(summary.mtime).toISOString(), attribution: { kind: "unknown" } };
  }

  private async sessionHint(docPath: string, review: ReviewFile | null): Promise<InboxSessionHint | null> {
    if (!review || unaddressedReviews(review).length === 0) return null;
    const [session] = this.deps.sessions.forDoc(docPath);
    if (!session) return null;
    return {
      id: session.id,
      title: session.title,
      live: session.live,
      canFocus: session.live && isWarpFocusUrl(session.warpFocusUrl),
      canResume: isSessionId(session.id) && (await isExistingDirectory(session.cwd)),
    };
  }
}
