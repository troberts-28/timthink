import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { HubEvent } from "@timthink/server";
import { useEffect } from "react";
import { fetchHistory, fetchInbox, fetchSnapshot } from "./changes";
import { fetchAttachments, fetchDoc, fetchDocSessions, fetchIndex, resolveCode } from "./client";
import { fetchArea, fetchAreaPage, fetchChecklist, fetchProject, fetchProjectPage } from "./projects";
import { lookupPrs } from "./prs";
import { fetchReview } from "./reviews";
import { fetchRound, fetchRoundFile } from "./rounds";

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
  prLookupRoot: ["pr-lookup"] as const,
  prLookup: (owner: string, repo: string, numbers: string) => ["pr-lookup", owner, repo, numbers] as const,
  projectRoot: ["project"] as const,
  project: (id: string) => ["project", id] as const,
  projectPage: (id: string) => ["project", id, "page"] as const,
  checklist: (id: string, checklist: string) => ["project", id, "checklist", checklist] as const,
  areaRoot: ["area"] as const,
  area: (id: string) => ["area", id] as const,
  areaPage: (id: string) => ["area", id, "page"] as const,
  roundRoot: ["round"] as const,
  round: (id: string) => ["round", id] as const,
  roundFile: (id: string, item: string) => ["round-file", id, item] as const,
};

export function useRound(id: string) {
  return useQuery({
    queryKey: queryKeys.round(id),
    queryFn: () => fetchRound(id),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function useRoundFile(id: string, item: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.roundFile(id, item),
    queryFn: () => fetchRoundFile(id, item),
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: queryKeys.project(id),
    queryFn: () => fetchProject(id),
    staleTime: 30_000,
    retry: false,
  });
}

export function useArea(id: string) {
  return useQuery({
    queryKey: queryKeys.area(id),
    queryFn: () => fetchArea(id),
    staleTime: 30_000,
    retry: false,
  });
}

export function useAreaPage(id: string) {
  return useQuery({
    queryKey: queryKeys.areaPage(id),
    queryFn: () => fetchAreaPage(id),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function useProjectPage(id: string) {
  return useQuery({
    queryKey: queryKeys.projectPage(id),
    queryFn: () => fetchProjectPage(id),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function useChecklist(id: string, checklist: string) {
  return useQuery({
    queryKey: queryKeys.checklist(id, checklist),
    queryFn: () => fetchChecklist(id, checklist),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

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

export function usePrLookup(owner: string, repo: string, numbers: readonly number[]) {
  const key = [...numbers].sort((a, b) => a - b).join(",");
  return useQuery({
    queryKey: queryKeys.prLookup(owner, repo, key),
    queryFn: () => lookupPrs(owner, repo, numbers),
    staleTime: 60_000,
    enabled: numbers.length > 0,
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
    const invalidateInbox = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectRoot });
      void queryClient.invalidateQueries({ queryKey: queryKeys.areaRoot });
    };
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
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projectRoot,
        predicate: (query) => query.queryKey.length === queryKeys.project("").length,
      });
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
    const onPrsChanged = (message: MessageEvent<string>) => {
      const event = parseEvent(message.data);
      if (event?.type !== "prs-changed") return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.prLookupRoot });
      invalidateInbox();
    };
    const onRoundsChanged = (message: MessageEvent<string>) => {
      const event = parseEvent(message.data);
      if (event?.type !== "rounds-changed") return;
      invalidateInbox();
      for (const id of event.ids) void queryClient.invalidateQueries({ queryKey: queryKeys.round(id) });
    };
    const openEventStream = () => {
      const stream = new EventSource("/api/events");
      stream.addEventListener("rounds-changed", onRoundsChanged);
      stream.addEventListener("prs-changed", onPrsChanged);
      stream.addEventListener("index-changed", onIndexChanged);
      stream.addEventListener("archive-changed", onIndexChanged);
      stream.addEventListener("doc-changed", onDocChanged);
      stream.addEventListener("doc-removed", onDocChanged);
      stream.addEventListener("sessions-changed", onSessionsChanged);
      stream.addEventListener("review-changed", onReviewChanged);
      stream.addEventListener("history-changed", onHistoryChanged);
      stream.addEventListener("seen-changed", onHistoryChanged);
      stream.addEventListener("ready", onIndexChanged);
      return stream;
    };

    // Chrome allows six HTTP/1.1 connections per host, and each open stream holds one,
    // so background tabs let theirs go and catch up on whatever they missed when shown.
    let stream: EventSource | null = null;
    let missedEvents = false;
    const followVisibility = () => {
      if (document.visibilityState === "visible" && stream === null) {
        stream = openEventStream();
        if (missedEvents) void queryClient.invalidateQueries();
        return;
      }
      if (document.visibilityState !== "visible" && stream !== null) {
        stream.close();
        stream = null;
        missedEvents = true;
      }
    };
    followVisibility();
    document.addEventListener("visibilitychange", followVisibility);
    return () => {
      document.removeEventListener("visibilitychange", followVisibility);
      stream?.close();
    };
  }, [queryClient]);
}
