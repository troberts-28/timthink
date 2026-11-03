import type { DocsIndex } from "@timthink/server";
import { FileText, FolderGit2, Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { isArchived } from "../lib/archive";
import { compactDate } from "../lib/format";
import { type SearchResult, searchIndex } from "../lib/navigation";
import { docHref, repoHref } from "../lib/routes";

function resultHref(result: SearchResult): string {
  return result.kind === "repo" ? repoHref(result.repo) : docHref(result.doc.path);
}

function resultKey(result: SearchResult): string {
  return result.kind === "repo" ? `repo:${result.repo}` : result.doc.path;
}

function ResultRow({ result }: { result: SearchResult }) {
  if (result.kind === "repo") {
    return (
      <>
        <FolderGit2 className="size-4 flex-none text-ink-32" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{result.repo}</span>
        <span className="flex-none text-meta text-ink-32">Repo</span>
      </>
    );
  }
  const { doc } = result;
  return (
    <>
      <FileText className="size-4 flex-none text-ink-32" strokeWidth={1.75} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate ${isArchived(doc) ? "text-ink-64" : "text-ink"}`}>{doc.title}</span>
        <span className="truncate font-mono text-[11.5px] text-ink-32">{doc.path}</span>
      </span>
      <span className="flex-none text-meta text-ink-32 tabular-nums">
        {isArchived(doc) ? "Archived · " : ""}
        {compactDate(doc.date)}
      </span>
    </>
  );
}

function PaletteBody({ index, onClose }: { index: DocsIndex; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchIndex(index, query), [index, query]);
  const current = Math.min(highlighted, Math.max(results.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector(`[data-position="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const open = (result: SearchResult | undefined) => {
    if (!result) return;
    onClose();
    navigate(resultHref(result));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((results.length + current + step) % Math.max(results.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(results[current]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line-soft px-4">
        <Search className="size-4 flex-none text-ink-32" strokeWidth={1.75} aria-hidden />
        <input
          // biome-ignore lint/a11y/noAutofocus: the palette opens on an explicit shortcut and search is its only job.
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Jump to a plan or repo"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[current] ? `${listId}-${current}` : undefined}
          className="h-12 min-w-0 flex-1 bg-transparent text-ui text-ink outline-none placeholder:text-ink-32"
        />
      </div>
      <div ref={listRef} id={listId} role="listbox" className="max-h-[min(60vh,480px)] overflow-y-auto p-1.5">
        {results.length === 0 ? (
          <p className="m-0 px-3 py-6 text-center text-ui text-ink-64">No plans match.</p>
        ) : (
          results.map((result, position) => (
            <div
              key={resultKey(result)}
              id={`${listId}-${position}`}
              role="option"
              tabIndex={-1}
              aria-selected={position === current}
              data-position={position}
              onMouseMove={() => setHighlighted(position)}
              onMouseDown={(event) => {
                event.preventDefault();
                open(result);
              }}
              className={`flex cursor-pointer items-center gap-3 rounded-button px-3 py-2 text-ui ${
                position === current ? "bg-accent-soft" : ""
              }`}
            >
              <ResultRow result={result} />
            </div>
          ))
        )}
      </div>
    </>
  );
}

export function CommandPalette({
  open,
  onClose,
  index,
}: {
  open: boolean;
  onClose: () => void;
  index: DocsIndex | undefined;
}) {
  if (!open || !index) return null;
  return (
    <div className="dialog-backdrop fixed inset-0 z-50 flex justify-center px-6 pt-[12vh]" role="presentation">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a plan"
        className="dialog-panel relative h-fit w-[min(640px,100%)] overflow-hidden rounded-card border border-line bg-surface-raised shadow-modal"
      >
        <PaletteBody index={index} onClose={onClose} />
      </div>
    </div>
  );
}
