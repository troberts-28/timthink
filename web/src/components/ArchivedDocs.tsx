import type { IndexedDoc } from "@timthink/server";
import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { DocList } from "./DocList";

export function ArchivedDocs({ docs, showLocation = false }: { docs: IndexedDoc[]; showLocation?: boolean }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (docs.length === 0) return null;
  return (
    <section aria-label="Archived plans" className="mb-10">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={listId}
        className="group mb-3 flex items-center gap-1.5 rounded-[6px] text-[12px] font-semibold uppercase leading-4 tracking-[0.06em] text-ink-32 hover:text-ink-64"
      >
        <ChevronRight
          className={`size-3.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          strokeWidth={2}
          aria-hidden
        />
        Archived
      </button>
      {open ? (
        <div id={listId}>
          <DocList docs={docs} showLocation={showLocation} />
        </div>
      ) : null}
    </section>
  );
}
