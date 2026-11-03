import { useQueryClient } from "@tanstack/react-query";
import type { ReviewView, SubmitResult, ThreadKind, Verdict } from "@timthink/server";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { markThreadRead } from "../api/changes";
import { queryKeys, useReviewState } from "../api/queries";
import {
  acceptSuggestion,
  createThread,
  deleteMessage,
  deleteThread,
  editThread,
  fetchReview,
  ReviewRequestError,
  replyToThread,
  saveAnswer,
  setThreadResolved,
  submitReview,
} from "../api/reviews";
import { useToast } from "../lib/toast";

export interface ComposerRequest {
  kind: ThreadKind;
  start: number;
  end: number;
  editingThreadId?: string;
  initialBody?: string;
  initialSuggestion?: string;
}

export interface AnswerDraft {
  questionId: string;
  prompt: string;
  choice: number | null;
  choiceText: string | null;
  note: string;
}

export interface ReviewActions {
  createThread(input: {
    kind: ThreadKind;
    start: number;
    end: number;
    body: string;
    suggestion: string | null;
  }): Promise<boolean>;
  editThread(id: string, body: string, suggestion: string | null): Promise<boolean>;
  deleteThread(id: string): Promise<boolean>;
  reply(id: string, body: string): Promise<boolean>;
  setResolved(id: string, resolved: boolean): Promise<boolean>;
  accept(id: string): Promise<boolean>;
  deleteMessage(id: string): Promise<boolean>;
  saveAnswer(answer: AnswerDraft): Promise<boolean>;
  submit(verdict: Verdict, body: string): Promise<SubmitResult | null>;
}

export interface ReviewContextValue {
  docPath: string;
  raw: string;
  docHash: string;
  review: ReviewView | undefined;
  anchorsCurrent: boolean;
  activeThreadId: string | null;
  setActiveThreadId(id: string | null): void;
  composer: ComposerRequest | null;
  openComposer(request: ComposerRequest): void;
  closeComposer(): void;
  showResolved: boolean;
  setShowResolved(show: boolean): void;
  submitOpen: boolean;
  setSubmitOpen(open: boolean): void;
  requestedVerdict: Verdict | null;
  openSubmit(verdict?: Verdict): void;
  actions: ReviewActions;
}

const ReviewContext = createContext<ReviewContextValue | null>(null);

export function useReviewContext(): ReviewContextValue | null {
  return useContext(ReviewContext);
}

export function useRequiredReview(): ReviewContextValue {
  const value = useContext(ReviewContext);
  if (!value) throw new Error("useRequiredReview must be used inside ReviewProvider");
  return value;
}

const CONFLICT_RETRIES = 1;

function useReviewRunner(docPath: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const latest = useCallback(
    (fresh: boolean): Promise<ReviewView> => {
      const key = queryKeys.review(docPath);
      const cached = queryClient.getQueryData<ReviewView>(key);
      if (cached && !fresh) return Promise.resolve(cached);
      return queryClient.fetchQuery({ queryKey: key, queryFn: () => fetchReview(docPath), staleTime: 0 });
    },
    [queryClient, docPath],
  );

  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const execute = useCallback(
    async <T,>(perform: (view: ReviewView) => Promise<T>, toView: (result: T) => ReviewView): Promise<T | null> => {
      const key = queryKeys.review(docPath);
      for (let attempt = 0; ; attempt += 1) {
        try {
          const result = await perform(await latest(attempt > 0));
          queryClient.setQueryData(key, toView(result));
          return result;
        } catch (error) {
          if (error instanceof ReviewRequestError && error.code === "conflict" && attempt < CONFLICT_RETRIES) continue;
          if (error instanceof ReviewRequestError && error.code === "doc-changed") {
            void queryClient.invalidateQueries({ queryKey: queryKeys.doc(docPath) });
            void queryClient.invalidateQueries({ queryKey: key });
            toast("The plan changed while you were reviewing. Check the new version and try again.", "bad");
            return null;
          }
          void queryClient.invalidateQueries({ queryKey: key });
          toast(error instanceof Error ? error.message : "Couldn't save the review", "bad");
          return null;
        }
      }
    },
    [latest, queryClient, docPath, toast],
  );

  return useCallback(
    <T,>(perform: (view: ReviewView) => Promise<T>, toView: (result: T) => ReviewView): Promise<T | null> => {
      const next = queue.current.then(() => execute(perform, toView));
      queue.current = next.catch(() => null);
      return next;
    },
    [execute],
  );
}

function useReviewActions(docPath: string, docHash: string): ReviewActions {
  const run = useReviewRunner(docPath);
  return useMemo<ReviewActions>(() => {
    const asView = (view: ReviewView) => view;
    const ok = async (promise: Promise<ReviewView | null>) => (await promise) !== null;
    return {
      createThread: (input) =>
        ok(run((view) => createThread({ path: docPath, version: view.version, docHash, ...input }), asView)),
      editThread: (id, body, suggestion) =>
        ok(run((view) => editThread(id, { path: docPath, version: view.version, body, suggestion }), asView)),
      deleteThread: (id) => ok(run((view) => deleteThread(id, { path: docPath, version: view.version }), asView)),
      reply: (id, body) => ok(run((view) => replyToThread(id, { path: docPath, version: view.version, body }), asView)),
      setResolved: (id, resolved) =>
        ok(run((view) => setThreadResolved(id, { path: docPath, version: view.version, resolved }), asView)),
      accept: (id) =>
        ok(run((view) => acceptSuggestion(id, { path: docPath, version: view.version, docHash }), asView)),
      deleteMessage: (id) => ok(run((view) => deleteMessage(id, { path: docPath, version: view.version }), asView)),
      saveAnswer: (answer) =>
        ok(run((view) => saveAnswer({ path: docPath, version: view.version, ...answer }), asView)),
      submit: (verdict, body) =>
        run(
          (view) => submitReview({ path: docPath, version: view.version, verdict, body }),
          (result) => result.review,
        ),
    };
  }, [run, docPath, docHash]);
}

interface ReviewProviderProps {
  docPath: string;
  raw: string;
  docHash: string;
  children: ReactNode;
}

export function ReviewProvider({ docPath, raw, docHash, children }: ReviewProviderProps) {
  const { data: review } = useReviewState(docPath);
  const actions = useReviewActions(docPath, docHash);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerRequest | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [submitOpen, setSubmitOpenState] = useState(false);
  const [requestedVerdict, setRequestedVerdict] = useState<Verdict | null>(null);
  const setSubmitOpen = useCallback((open: boolean) => {
    setSubmitOpenState(open);
    if (!open) setRequestedVerdict(null);
  }, []);
  const openSubmit = useCallback((verdict?: Verdict) => {
    setRequestedVerdict(verdict ?? null);
    setSubmitOpenState(true);
  }, []);
  const closeComposer = useCallback(() => setComposer(null), []);
  const activateThread = useCallback(
    (id: string | null) => {
      setActiveThreadId(id);
      const thread = id ? review?.threads.find((candidate) => candidate.id === id) : undefined;
      if (thread?.messages.at(-1)?.author === "claude") void markThreadRead(docPath, thread.id).catch(() => {});
    },
    [docPath, review],
  );
  const value = useMemo<ReviewContextValue>(
    () => ({
      docPath,
      raw,
      docHash,
      review,
      anchorsCurrent: review?.docHash === docHash,
      activeThreadId,
      setActiveThreadId: activateThread,
      composer,
      openComposer: setComposer,
      closeComposer,
      showResolved,
      setShowResolved,
      submitOpen,
      setSubmitOpen,
      requestedVerdict,
      openSubmit,
      actions,
    }),
    [
      docPath,
      raw,
      docHash,
      review,
      activeThreadId,
      activateThread,
      composer,
      closeComposer,
      showResolved,
      submitOpen,
      setSubmitOpen,
      requestedVerdict,
      openSubmit,
      actions,
    ],
  );
  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}
