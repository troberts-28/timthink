import { ChevronRight, Minus } from "lucide-react";
import { useState } from "react";
import { deletionLabel } from "./blockDiff";
import { useChanges } from "./ChangesContext";

const PREVIEW_LENGTH = 110;

function preview(text: string): string {
  const flat = deletionLabel(text);
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…` : flat;
}

export function RemovedGhost({ id }: { id: string }) {
  const changes = useChanges();
  const [open, setOpen] = useState(false);
  const block = changes?.diff?.removed.find((candidate) => candidate.id === id);
  if (!block) return null;
  return (
    <aside className="diff-ghost" data-diff-ghost={id} contentEditable={false} aria-label="Removed block">
      <button type="button" className="diff-ghost-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Minus className="size-3.5 flex-none text-bad" strokeWidth={2.5} aria-hidden />
        <span className="flex-none font-semibold text-bad-ink">Removed</span>
        <span className="min-w-0 truncate text-ink-64">{preview(block.text)}</span>
        <ChevronRight
          className={`ml-auto size-3.5 flex-none text-ink-32 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
      </button>
      {open ? <pre className="diff-ghost-body">{block.text}</pre> : null}
    </aside>
  );
}
