import type { DocDetail, DocHistory, SeenMark, SnapshotView } from "@timthink/server";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { markSeen, markUnseen } from "../api/changes";
import { useDocHistory, useSnapshot } from "../api/queries";
import { useToast } from "../lib/toast";
import { type DocDiff, diffDocuments } from "./blockDiff";

export const AUTO_SEEN_DELAY_MS = 2000;
const SHORT_HASH_LENGTH = 8;

export function shortHash(hash: string): string {
  return hash.slice(0, SHORT_HASH_LENGTH);
}

export interface ChangesContextValue {
  docPath: string;
  raw: string;
  history: DocHistory | undefined;
  baseline: SnapshotView | null;
  comparingHistory: boolean;
  changesSinceBaseline: SnapshotView[];
  latestChange: SnapshotView | null;
  diff: DocDiff | null;
  hasChanges: boolean;
  showChanges: boolean;
  setShowChanges(show: boolean): void;
  showInlineSince(snapshotId: string | null): void;
  markAsSeen(): void;
  markAsUnseen(): void;
}

const ChangesContext = createContext<ChangesContextValue | null>(null);

export function useChanges(): ChangesContextValue | null {
  return useContext(ChangesContext);
}

function newestWithHash(snapshots: readonly SnapshotView[], hash: string): SnapshotView | null {
  return snapshots.find((snapshot) => snapshot.shortHash === shortHash(hash)) ?? null;
}

function useAutoSeen(docPath: string, hash: string, ready: boolean) {
  const done = useRef(false);
  const hashRef = useRef(hash);
  hashRef.current = hash;
  useEffect(() => {
    if (!ready || done.current) return;
    let timer: number | null = null;
    const fire = () => {
      done.current = true;
      void markSeen(docPath, hashRef.current).catch(() => {});
    };
    const arm = () => {
      if (document.visibilityState === "visible" && timer === null) timer = window.setTimeout(fire, AUTO_SEEN_DELAY_MS);
      if (document.visibilityState !== "visible" && timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      document.removeEventListener("visibilitychange", arm);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [docPath, ready]);
  return done;
}

interface BaselineComparison {
  baseline: SnapshotView | null;
  chosen: SnapshotView | null;
  changesSinceBaseline: SnapshotView[];
  latestChange: SnapshotView | null;
  hasChanges: boolean;
}

function compareWithBaseline(
  snapshots: readonly SnapshotView[],
  currentHash: string,
  seenAtOpen: SeenMark | null,
  chosenId: string | null,
): BaselineComparison {
  const chosen = chosenId ? (snapshots.find((snapshot) => snapshot.id === chosenId) ?? null) : null;
  const baseline = chosen ?? (seenAtOpen ? newestWithHash(snapshots, seenAtOpen.hash) : null);
  const changesSinceBaseline = baseline ? snapshots.filter((snapshot) => snapshot.at > baseline.at) : [];
  const caughtUp = snapshots[0]?.shortHash === shortHash(currentHash);
  const differs = baseline !== null && baseline.shortHash !== shortHash(currentHash);
  const byOthers = changesSinceBaseline.some((snapshot) => snapshot.attribution.kind !== "human");
  return {
    baseline,
    chosen,
    changesSinceBaseline,
    latestChange:
      changesSinceBaseline.find((snapshot) => snapshot.attribution.kind !== "human") ?? changesSinceBaseline[0] ?? null,
    hasChanges: differs && (chosen !== null || (caughtUp && byOthers)),
  };
}

export function ChangesProvider({ doc, children }: { doc: DocDetail; children: ReactNode }) {
  const docPath = doc.summary.path;
  const toast = useToast();
  const { data: history } = useDocHistory(docPath);
  const [seenAtOpen, setSeenAtOpen] = useState<SeenMark | null | undefined>(undefined);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);

  useEffect(() => {
    if (seenAtOpen === undefined && history)
      setSeenAtOpen(history.seen ? { hash: history.seen.hash, at: history.seen.at } : null);
  }, [history, seenAtOpen]);

  const autoSeen = useAutoSeen(docPath, doc.hash, seenAtOpen !== undefined);
  const { baseline, chosen, changesSinceBaseline, latestChange, hasChanges } = useMemo(
    () => compareWithBaseline(history?.snapshots ?? [], doc.hash, seenAtOpen ?? null, chosenId),
    [history, doc.hash, seenAtOpen, chosenId],
  );

  const { data: baselineRaw } = useSnapshot(docPath, hasChanges && baseline ? baseline.id : null);
  const diff = useMemo(
    () => (hasChanges && baselineRaw !== undefined ? diffDocuments(baselineRaw, doc.raw) : null),
    [hasChanges, baselineRaw, doc.raw],
  );

  const markAsSeen = useCallback(() => {
    autoSeen.current = true;
    setSeenAtOpen({ hash: doc.hash, at: new Date().toISOString() });
    setChosenId(null);
    setShowChanges(false);
    markSeen(docPath, doc.hash).catch((error: unknown) =>
      toast(error instanceof Error ? error.message : "Couldn't mark the plan as seen", "bad"),
    );
  }, [autoSeen, doc.hash, docPath, toast]);

  const markAsUnseen = useCallback(() => {
    autoSeen.current = true;
    markUnseen(docPath)
      .then(({ seen }) => {
        setSeenAtOpen(seen ? { hash: seen.hash, at: seen.at } : null);
        toast("Marked as unseen. It's back in your inbox.");
      })
      .catch((error: unknown) => toast(error instanceof Error ? error.message : "Couldn't mark as unseen", "bad"));
  }, [autoSeen, docPath, toast]);

  const showInlineSince = useCallback((snapshotId: string | null) => {
    setChosenId(snapshotId);
    setShowChanges(snapshotId !== null);
  }, []);

  const value = useMemo<ChangesContextValue>(
    () => ({
      docPath,
      raw: doc.raw,
      history,
      baseline,
      comparingHistory: chosen !== null,
      changesSinceBaseline,
      latestChange,
      diff,
      hasChanges,
      showChanges: showChanges && hasChanges && diff !== null,
      setShowChanges,
      showInlineSince,
      markAsSeen,
      markAsUnseen,
    }),
    [
      docPath,
      doc.raw,
      history,
      baseline,
      chosen,
      changesSinceBaseline,
      latestChange,
      diff,
      hasChanges,
      showChanges,
      showInlineSince,
      markAsSeen,
      markAsUnseen,
    ],
  );
  return <ChangesContext.Provider value={value}>{children}</ChangesContext.Provider>;
}
