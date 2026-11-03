import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { HubEvent } from "@timthink/server";
import { useEffect } from "react";
import { fetchHistory, fetchInbox, fetchSnapshot } from "./changes";
import { fetchAttachments, fetchDoc, fetchDocSessions, fetchIndex, resolveCode } from "./client";
import { fetchReview } from "./reviews";

export const queryKeys = {
  index: ["index"] as const,
  doc: (path: string) => ["doc", path] as const,
  review: (path: string) => ["review", path] as const,
  resolveForDoc: (docPath: string) => ["resolve-code", docPath] as const,
  resolve: (docPath: string, repo: string, ref: string) => ["resolve-code", docPath, repo, ref] as const,
  docSessionsRoot: ["doc-sessions"] as const,
  docSessions: (docPath: string) => ["doc-sessions", docPath] as const,
  attachmentsRoot: ["attachments"] as const,
  attachments: (repo: string, project: string | null) => ["attachments", repo, project] as const,
  historyRoot: ["history"] as const,
  history: (path: string) => ["history", path] as const,
  snapshot: (path: string, id: string) => ["snapshot", path, id] as const,
  inbox: ["inbox"] as const,
};

export function useDocHistory(path: string) {
  return useQuery({
    queryKey: queryKeys.history(path),
    queryFn: () => fetchHistory(path),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function useSnapshot(path: string, id: string | null) {
  return useQuery({
    queryKey: queryKeys.snapshot(path, id ?? ""),
    queryFn: () => fetchSnapshot(path, id ?? ""),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: id !== null,
    retry: false,
  });
}

export function useInbox() {
  return useQuery({ queryKey: queryKeys.inbox, queryFn: fetchInbox, staleTime: Number.POSITIVE_INFINITY });
}

export function useAttachments(repo: string, project: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.attachments(repo, project),
    queryFn: () => fetchAttachments(repo, project),
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
  });
}

export function useDocsIndex() {
  return useQuery({ queryKey: queryKeys.index, queryFn: fetchIndex, staleTime: Number.POSITIVE_INFINITY });
}

export function useDoc(path: string) {
  return useQuery({
    queryKey: queryKeys.doc(path),
    queryFn: () => fetchDoc(path),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function useReviewState(path: string) {
  return useQuery({
    queryKey: queryKeys.review(path),
    queryFn: () => fetchReview(path),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function useCodeResolution(repo: string, ref: string, docPath: string) {
  return useQuery({
    queryKey: queryKeys.resolve(docPath, repo, ref),
    queryFn: () => resolveCode(repo, ref, docPath),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useDocSessions(docPath: string) {
  return useQuery({
    queryKey: queryKeys.docSessions(docPath),
    queryFn: () => fetchDocSessions(docPath),
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.data?.scanning ? 3_000 : false),
  });
}

function parseEvent(data: string): HubEvent | null {
  try {
    return JSON.parse(data) as HubEvent;
  } catch {
    return null;
  }
}

export function useLiveUpdates(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource("/api/events");
    const invalidateInbox = () => void queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
    const onIndexChanged = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.index });
      void queryClient.invalidateQueries({ queryKey: queryKeys.attachmentsRoot });
      invalidateInbox();
    };
    const onDocChanged = (message: MessageEvent<string>) => {
      const event = parseEvent(message.data);
      if (event && (event.type === "doc-changed" || event.type === "doc-removed")) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.doc(event.path) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.review(event.path) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.history(event.path) });
        invalidateInbox();
      }
    };
    const onReviewChanged = (message: MessageEvent<string>) => {
      const event = parseEvent(message.data);
      if (event?.type === "review-changed") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.review(event.path) });
        invalidateInbox();
      }
    };
    const onHistoryChanged = (message: MessageEvent<string>) => {
      const event = parseEvent(message.data);
      if (event?.type === "history-changed" || event?.type === "seen-changed") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.history(event.path) });
        invalidateInbox();
      }
    };
    const onSessionsChanged = (message: MessageEvent<string>) => {
      const event = parseEvent(message.data);
      if (event?.type !== "sessions-changed") return;
      invalidateInbox();
      if (event.docPaths.length === 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.docSessionsRoot });
        void queryClient.invalidateQueries({ queryKey: queryKeys.historyRoot });
        return;
      }
      for (const docPath of event.docPaths) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.docSessions(docPath) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.resolveForDoc(docPath) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.history(docPath) });
      }
    };
    source.addEventListener("index-changed", onIndexChanged);
    source.addEventListener("archive-changed", onIndexChanged);
    source.addEventListener("doc-changed", onDocChanged);
    source.addEventListener("doc-removed", onDocChanged);
    source.addEventListener("sessions-changed", onSessionsChanged);
    source.addEventListener("review-changed", onReviewChanged);
    source.addEventListener("history-changed", onHistoryChanged);
    source.addEventListener("seen-changed", onHistoryChanged);
    source.addEventListener("ready", onIndexChanged);
    return () => source.close();
  }, [queryClient]);
}
