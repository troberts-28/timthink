import { readFile } from "node:fs/promises";
import { resolveInsideRoot } from "../safePath.js";
import { createAnchor, locateAnchor, refreshAnchor } from "./anchor.js";
import { writeFileAtomic } from "./atomicWrite.js";
import { setFrontmatterStatus } from "./frontmatterStatus.js";
import {
  type Actor,
  type AnswerInput,
  acknowledgeAnswer,
  addReply,
  addThread,
  appendSystemMessage,
  deleteDraftMessage,
  deleteDraftThread,
  draftReview,
  editDraftThread,
  markAddressed,
  ReviewOperationError,
  setThreadResolved,
  submitReview,
  type ThreadEdit,
  upsertDraftAnswer,
} from "./operations.js";
import { docHash } from "./paths.js";
import { needsReanchor, reanchorThreads } from "./reanchor.js";
import { ReviewConflictError, ReviewStore } from "./reviewStore.js";
import type { ReviewFile, ThreadKind, Verdict } from "./schema.js";
import { userNameResolver } from "./userName.js";

export interface ReviewView extends ReviewFile {
  docHash: string;
  draftReviewId: string | null;
  userName: string;
}

export type StatusUpdate =
  | { status: "updated"; value: string }
  | { status: "unchanged" }
  | { status: "failed"; message: string };

export interface SubmitResult {
  review: ReviewView;
  statusUpdate: StatusUpdate;
}

export class DocChangedError extends Error {
  constructor() {
    super("The plan changed since you loaded it");
    this.name = "DocChangedError";
  }
}

export class DocNotFoundError extends Error {}

export interface LoadedDoc {
  absolute: string;
  raw: string;
  hash: string;
}

export interface NewThreadRequest {
  version: number;
  docHash: string;
  start: number;
  end: number;
  kind: ThreadKind;
  body: string;
  suggestion: string | null;
}

const VERDICT_STATUS: Record<Verdict, string | null> = {
  approve: "approved",
  request_changes: "draft",
  comment: null,
};

const ACCEPTED_MESSAGE = "Accepted";

export interface HubDocWrite {
  docPath: string;
  before: string;
  after: string;
  actorName: string;
}

export interface ReviewServiceOptions {
  docsRoot: string;
  userName: string | null;
  now?: () => string;
  onDocWrite?: (write: HubDocWrite) => void;
}

export class ReviewService {
  readonly store: ReviewStore;
  private readonly userName: () => Promise<string>;
  private readonly now: () => string;

  constructor(private readonly options: ReviewServiceOptions) {
    this.store = new ReviewStore(options.docsRoot);
    this.userName = userNameResolver(options.userName);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async readDoc(docPath: string): Promise<LoadedDoc> {
    this.store.filePath(docPath);
    const absolute = await resolveInsideRoot(this.options.docsRoot, docPath).catch(() => null);
    const raw = absolute ? await readFile(absolute, "utf8").catch(() => null) : null;
    if (!absolute || raw === null) throw new DocNotFoundError(`No plan at ${docPath}`);
    return { absolute, raw, hash: docHash(raw) };
  }

  async humanActor(): Promise<Actor> {
    return { author: "human", name: await this.userName() };
  }

  async state(docPath: string): Promise<ReviewView> {
    const doc = await this.readDoc(docPath);
    let file = await this.store.read(docPath);
    if (needsReanchor(file, doc.hash)) {
      try {
        file = await this.store.update(docPath, file.version, (current) => reanchorThreads(current, doc.raw, doc.hash));
      } catch (error) {
        if (!(error instanceof ReviewConflictError)) throw error;
        file = reanchorThreads(await this.store.read(docPath), doc.raw, doc.hash);
      }
    }
    return this.view(file, doc.hash);
  }

  async createThread(docPath: string, request: NewThreadRequest): Promise<ReviewView> {
    const actor = await this.humanActor();
    return this.mutate(docPath, request.version, (file, doc) => {
      if (doc.hash !== request.docHash) throw new DocChangedError();
      const anchor = createAnchor(doc.raw, request.start, request.end, doc.hash);
      const suggestion = request.kind === "suggestion" ? request.suggestion : null;
      return addThread(file, { kind: request.kind, anchor, body: request.body, suggestion }, actor, this.now());
    });
  }

  async editThread(docPath: string, version: number, threadId: string, edit: ThreadEdit): Promise<ReviewView> {
    const actor = await this.humanActor();
    return this.mutate(docPath, version, (file) => editDraftThread(file, threadId, edit, actor, this.now()));
  }

  deleteThread(docPath: string, version: number, threadId: string): Promise<ReviewView> {
    return this.mutate(docPath, version, (file) => deleteDraftThread(file, threadId));
  }

  async reply(docPath: string, version: number | null, threadId: string, body: string, actor?: Actor) {
    const by = actor ?? (await this.humanActor());
    return this.mutate(docPath, version, (file) => addReply(file, threadId, body, by, this.now()));
  }

  deleteMessage(docPath: string, version: number, messageId: string): Promise<ReviewView> {
    return this.mutate(docPath, version, (file) => deleteDraftMessage(file, messageId));
  }

  async setResolved(
    docPath: string,
    version: number | null,
    threadId: string,
    resolved: boolean,
    options: { actor?: Actor; message?: string } = {},
  ): Promise<ReviewView> {
    const actor = options.actor ?? (await this.humanActor());
    return this.mutate(docPath, version, (file) => {
      const now = this.now();
      const withMessage = options.message?.trim() ? addReply(file, threadId, options.message, actor, now) : file;
      return setThreadResolved(withMessage, threadId, resolved, actor, now);
    });
  }

  async answer(docPath: string, version: number, input: AnswerInput): Promise<ReviewView> {
    const actor = await this.humanActor();
    return this.mutate(docPath, version, (file) => upsertDraftAnswer(file, input, actor, this.now()));
  }

  acknowledgeAnswer(docPath: string, questionId: string, message: string): Promise<ReviewView> {
    return this.mutate(docPath, null, (file) => acknowledgeAnswer(file, questionId, message, this.now()));
  }

  markAddressed(docPath: string): Promise<ReviewView> {
    return this.mutate(docPath, null, (file) => markAddressed(file, this.now()));
  }

  async acceptSuggestion(docPath: string, version: number, threadId: string, seenHash: string): Promise<ReviewView> {
    const actor = await this.humanActor();
    let updatedHash: string | null = null;
    const view = await this.mutate(docPath, version, async (file, doc) => {
      if (doc.hash !== seenHash) throw new DocChangedError();
      const thread = file.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new ReviewOperationError("not-found", `No thread with id ${threadId}`);
      if (thread.kind !== "suggestion" || thread.suggestion === null) {
        throw new ReviewOperationError("invalid", "Only suggestions can be accepted");
      }
      const match = thread.status === "outdated" ? null : locateAnchor(doc.raw, thread.anchor);
      if (!match) throw new ReviewOperationError("invalid", "The suggested passage no longer exists in the plan");
      const updatedRaw = doc.raw.slice(0, match.start) + thread.suggestion + doc.raw.slice(match.end);
      const latest = await readFile(doc.absolute, "utf8");
      if (docHash(latest) !== doc.hash) throw new DocChangedError();
      this.options.onDocWrite?.({ docPath, before: doc.raw, after: updatedRaw, actorName: actor.name });
      await writeFileAtomic(doc.absolute, updatedRaw);
      updatedHash = docHash(updatedRaw);
      const insertedEnd = match.start + thread.suggestion.length;
      const anchor =
        thread.suggestion.length > 0
          ? refreshAnchor(updatedRaw, { method: "exact", start: match.start, end: insertedEnd }, updatedHash)
          : thread.anchor;
      const now = this.now();
      const withAnchor = {
        ...file,
        threads: file.threads.map((entry) => (entry.id === threadId ? { ...entry, anchor } : entry)),
      };
      const resolved = setThreadResolved(withAnchor, threadId, true, actor, now);
      const withMessage = appendSystemMessage(resolved, threadId, ACCEPTED_MESSAGE, actor, now);
      return reanchorThreads(withMessage, updatedRaw, updatedHash);
    });
    return { ...view, docHash: updatedHash ?? view.docHash };
  }

  async submit(docPath: string, version: number, verdict: Verdict, body: string): Promise<SubmitResult> {
    const actor = await this.humanActor();
    const review = await this.mutate(docPath, version, (file) => submitReview(file, verdict, body, actor, this.now()));
    const statusUpdate = await this.applyVerdictStatus(docPath, verdict);
    if (statusUpdate.status !== "updated") return { review, statusUpdate };
    return { review: await this.state(docPath), statusUpdate };
  }

  private async applyVerdictStatus(docPath: string, verdict: Verdict): Promise<StatusUpdate> {
    const status = VERDICT_STATUS[verdict];
    if (!status) return { status: "unchanged" };
    try {
      const doc = await this.readDoc(docPath);
      const updated = setFrontmatterStatus(doc.raw, status);
      if (updated === doc.raw) return { status: "unchanged" };
      this.options.onDocWrite?.({
        docPath,
        before: doc.raw,
        after: updated,
        actorName: (await this.humanActor()).name,
      });
      await writeFileAtomic(doc.absolute, updated);
      return { status: "updated", value: status };
    } catch (error) {
      return { status: "failed", message: error instanceof Error ? error.message : "Couldn't update the status" };
    }
  }

  private async mutate(
    docPath: string,
    version: number | null,
    operation: (file: ReviewFile, doc: LoadedDoc) => ReviewFile | Promise<ReviewFile>,
  ): Promise<ReviewView> {
    const doc = await this.readDoc(docPath);
    const file = await this.store.update(docPath, version, (current) =>
      operation(reanchorThreads(current, doc.raw, doc.hash), doc),
    );
    return this.view(file, doc.hash);
  }

  private async view(file: ReviewFile, hash: string): Promise<ReviewView> {
    return { ...file, docHash: hash, draftReviewId: draftReview(file)?.id ?? null, userName: await this.userName() };
  }
}
