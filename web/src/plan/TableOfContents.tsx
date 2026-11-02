import type { TocEntry } from "../markdown/rehypePlugins";

const MAX_DEPTH = 3;

interface TableOfContentsProps {
  toc: readonly TocEntry[];
  activeId: string | null;
  onNavigate?: () => void;
}

export function TableOfContents({ toc, activeId, onNavigate }: TableOfContentsProps) {
  const entries = toc.filter((entry) => entry.depth >= 2 && entry.depth <= MAX_DEPTH);
  if (entries.length === 0) return null;
  return (
    <ol className="m-0 flex list-none flex-col border-l border-line-soft p-0">
      {entries.map((entry) => {
        const active = entry.id === activeId;
        return (
          <li key={entry.id} className="relative">
            {active ? (
              <span className="absolute top-1 bottom-1 -left-px w-0.5 rounded-full bg-accent" aria-hidden />
            ) : null}
            <a
              href={`#${entry.id}`}
              onClick={onNavigate}
              className={`block py-1 pr-2 text-[13px] leading-[18px] transition-colors duration-150 ${
                entry.depth === 3 ? "pl-6" : "pl-3.5"
              } ${active ? "font-medium text-ink" : "text-ink-64 hover:text-ink"}`}
            >
              {entry.text}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
