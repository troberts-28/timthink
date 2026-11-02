import { ChevronDown, ListTree } from "lucide-react";
import { useCallback, useState } from "react";
import { useDismiss } from "../lib/useDismiss";
import type { TocEntry } from "../markdown/rehypePlugins";
import { TableOfContents } from "./TableOfContents";

export function ContentsMenu({ toc, activeId }: { toc: readonly TocEntry[]; activeId: string | null }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const containerRef = useDismiss<HTMLDivElement>(open, close);
  if (!toc.some((entry) => entry.depth === 2 || entry.depth === 3)) return null;
  const current = toc.find((entry) => entry.id === activeId);
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex h-8 max-w-[260px] items-center gap-2 rounded-button border px-3 text-meta font-medium transition-colors duration-150 ${
          open ? "border-line bg-bg-sunken text-ink" : "border-line-soft text-ink-64 hover:border-line hover:text-ink"
        }`}
      >
        <ListTree className="size-3.5 flex-none" strokeWidth={2} aria-hidden />
        <span className="truncate">{current ? current.text : "Contents"}</span>
        <ChevronDown
          className={`size-3.5 flex-none transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="On this page"
          className="popover-enter popover-enter-right absolute top-full right-0 z-40 mt-2 w-[300px] rounded-card border border-line bg-surface-raised py-3 shadow-pop"
        >
          <p className="m-0 mb-2 px-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-32">
            On this page
          </p>
          <div className="scroll-quiet max-h-[min(60vh,520px)] overflow-y-auto px-2">
            <TableOfContents toc={toc} activeId={activeId} onNavigate={close} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
