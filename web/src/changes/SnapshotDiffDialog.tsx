import { ArrowRight, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useMemo } from "react";
import { useSnapshot } from "../api/queries";
import { collapseContext, rawDiff, type WordPart } from "./rawDiff";

export interface DiffSide {
  id: string | null;
  label: string;
}

interface SnapshotDiffDialogProps {
  docPath: string;
  currentRaw: string;
  from: DiffSide;
  to: DiffSide;
  onClose: () => void;
}

function Words({ parts, tone }: { parts: readonly WordPart[]; tone: "removed" | "added" }) {
  return (
    <>
      {parts.map((part, index) =>
        part.changed ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are a static rendering of one diff.
          <mark key={index} className={`rawdiff-word rawdiff-word-${tone}`}>
            {part.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are a static rendering of one diff.
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function useSide(docPath: string, side: DiffSide, currentRaw: string) {
  const { data, isLoading } = useSnapshot(docPath, side.id);
  return { raw: side.id === null ? currentRaw : data, loading: side.id !== null && isLoading };
}

export function SnapshotDiffDialog({ docPath, currentRaw, from, to, onClose }: SnapshotDiffDialogProps) {
  const titleId = useId();
  const before = useSide(docPath, from, currentRaw);
  const after = useSide(docPath, to, currentRaw);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const chunks = useMemo(
    () =>
      before.raw !== undefined && after.raw !== undefined ? collapseContext(rawDiff(before.raw, after.raw)) : null,
    [before.raw, after.raw],
  );
  const identical = chunks?.every((chunk) => chunk.kind !== "change") ?? false;

  return (
    <div className="dialog-backdrop fixed inset-0 z-50 grid place-items-center p-6" role="presentation">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog-panel relative flex max-h-[min(820px,calc(100vh-48px))] w-[min(920px,100%)] flex-col rounded-card border border-line bg-surface-raised shadow-modal"
      >
        <header className="flex items-start gap-3 border-b border-line-soft px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="m-0 text-[18px] leading-[26px] font-semibold text-ink">
              Compare versions
            </h2>
            <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-ui text-ink-64">
              <span className="chip chip-bad">{from.label}</span>
              <ArrowRight className="size-3.5 text-ink-32" aria-hidden />
              <span className="chip chip-ok-soft">{to.label}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 flex-none place-items-center rounded-button text-ink-64 hover:bg-bg-sunken hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="scroll-quiet min-h-0 flex-1 overflow-auto px-6 py-5">
          {chunks === null ? (
            <p className="m-0 flex items-center gap-2 text-ui text-ink-64">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              Loading versions…
            </p>
          ) : identical ? (
            <p className="m-0 text-ui text-ink-64">These versions are identical.</p>
          ) : (
            <div className="rawdiff">
              {chunks.map((chunk, index) => {
                const key = `${chunk.kind}-${index}`;
                if (chunk.kind === "skip") {
                  return (
                    <div key={key} className="rawdiff-skip">
                      ⋯ {chunk.count} unchanged line{chunk.count === 1 ? "" : "s"}
                    </div>
                  );
                }
                if (chunk.kind === "same") {
                  return (
                    <div key={key} className="rawdiff-row">
                      <span className="rawdiff-sign" aria-hidden />
                      <span className="rawdiff-text">{chunk.lines.join("\n")}</span>
                    </div>
                  );
                }
                return (
                  <div key={key}>
                    {chunk.removed.length > 0 ? (
                      <div className="rawdiff-row rawdiff-removed">
                        <span className="rawdiff-sign">
                          <span aria-hidden>−</span>
                          <span className="sr-only">Removed</span>
                        </span>
                        <span className="rawdiff-text">
                          <Words parts={chunk.removed} tone="removed" />
                        </span>
                      </div>
                    ) : null}
                    {chunk.added.length > 0 ? (
                      <div className="rawdiff-row rawdiff-added">
                        <span className="rawdiff-sign">
                          <span aria-hidden>+</span>
                          <span className="sr-only">Added</span>
                        </span>
                        <span className="rawdiff-text">
                          <Words parts={chunk.added} tone="added" />
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
