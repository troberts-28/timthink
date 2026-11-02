import type { SnapshotView } from "@timthink/server";
import { Check, ChevronDown, History } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "../components/Button";
import { relativeTime } from "../lib/format";
import { useDismiss } from "../lib/useDismiss";
import { authorName } from "./attribution";
import { shortHash, useChanges } from "./ChangesContext";
import { type DiffSide, SnapshotDiffDialog } from "./SnapshotDiffDialog";

const MAX_SELECTED = 2;

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function snapshotLabel(snapshot: SnapshotView, currentShort: string): string {
  return snapshot.shortHash === currentShort ? "Current" : DATE_TIME.format(new Date(snapshot.at));
}

function SnapshotRow({
  snapshot,
  selected,
  tags,
  onToggle,
}: {
  snapshot: SnapshotView;
  selected: boolean;
  tags: string[];
  onToggle: () => void;
}) {
  const { attribution } = snapshot;
  return (
    <li>
      <label
        className={`flex w-full cursor-pointer items-start gap-3 px-4 py-2.5 text-left transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
          selected ? "bg-accent-soft/60" : "hover:bg-bg-sunken"
        }`}
      >
        <input type="checkbox" className="sr-only" checked={selected} onChange={onToggle} />
        <span
          className={`mt-0.5 grid size-4 flex-none place-items-center rounded-[5px] border-[1.5px] ${
            selected ? "border-accent bg-accent text-on-accent" : "border-ink-32"
          }`}
          aria-hidden
        >
          {selected ? <Check className="size-3" strokeWidth={3} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-ui font-medium text-ink">
            {relativeTime(Date.parse(snapshot.at))}
            {tags.map((tag) => (
              <span
                key={tag}
                className={`chip ${tag === "Current" ? "chip-ok-soft" : "chip-accent"} h-[18px] px-1.5 text-[11px]`}
              >
                {tag}
              </span>
            ))}
          </span>
          <span className="mt-0.5 block truncate text-meta text-ink-64">
            {authorName(attribution)}
            {attribution.kind === "claude" ? ` · “${attribution.sessionTitle}”` : ""}
          </span>
        </span>
        <time dateTime={snapshot.at} className="flex-none pt-0.5 text-meta text-ink-32 tabular-nums">
          {DATE_TIME.format(new Date(snapshot.at))}
        </time>
      </label>
    </li>
  );
}

export function HistoryMenu({ currentHash }: { currentHash: string }) {
  const changes = useChanges();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState<{ from: DiffSide; to: DiffSide } | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const containerRef = useDismiss<HTMLDivElement>(open && comparing === null, close);
  const snapshots = changes?.history?.snapshots ?? [];
  if (!changes || snapshots.length === 0) return null;
  const currentShort = shortHash(currentHash);
  const seenShort = changes.history?.seen ? shortHash(changes.history.seen.hash) : null;
  const lastSeenId = snapshots.find((snapshot) => snapshot.shortHash === seenShort)?.id ?? null;
  const chosen = snapshots.filter((snapshot) => selected.includes(snapshot.id));
  const [older, newer] = [...chosen].sort((a, b) => a.at.localeCompare(b.at));
  const oneOlderThanNow = chosen.length === 1 && older !== undefined && older.shortHash !== currentShort;

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id].slice(-MAX_SELECTED),
    );

  const compare = () => {
    if (!older) return;
    const to: DiffSide = newer
      ? { id: newer.shortHash === currentShort ? null : newer.id, label: snapshotLabel(newer, currentShort) }
      : { id: null, label: "Current" };
    setComparing({ from: { id: older.id, label: snapshotLabel(older, currentShort) }, to });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex h-8 items-center gap-2 rounded-button border px-3 text-meta font-medium transition-colors duration-150 ${
          open ? "border-line bg-bg-sunken text-ink" : "border-line-soft text-ink-64 hover:border-line hover:text-ink"
        }`}
      >
        <History className="size-3.5" strokeWidth={2} aria-hidden />
        History
        <ChevronDown className={`size-3.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Plan history"
          className="popover-enter popover-enter-right absolute top-full right-0 z-30 mt-2 w-[min(400px,calc(100vw-48px))] overflow-hidden rounded-card border border-line bg-surface-raised shadow-pop"
        >
          <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-64">Versions</p>
            <span className="ml-auto text-meta text-ink-32">{snapshots.length}</span>
          </div>
          <ul className="scroll-quiet m-0 max-h-[min(50vh,420px)] list-none divide-y divide-line-soft overflow-y-auto p-0">
            {snapshots.map((snapshot) => (
              <SnapshotRow
                key={snapshot.id}
                snapshot={snapshot}
                selected={selected.includes(snapshot.id)}
                tags={[
                  ...(snapshot.shortHash === currentShort && snapshot.id === snapshots[0]?.id ? ["Current"] : []),
                  ...(snapshot.id === lastSeenId ? ["Last seen"] : []),
                ]}
                onToggle={() => toggle(snapshot.id)}
              />
            ))}
          </ul>
          <div className="flex items-center gap-2 border-t border-line-soft px-4 py-3">
            <p className="m-0 min-w-0 flex-1 text-meta text-ink-64">
              {chosen.length === 0
                ? "Pick a version to compare with now, or two to compare."
                : chosen.length === 1
                  ? "Compare with the current version, or pick another."
                  : "Compare these two versions."}
            </p>
            {oneOlderThanNow ? (
              <Button
                size="sm"
                tone="ghost"
                onClick={() => {
                  changes.showInlineSince(older.id);
                  setOpen(false);
                }}
              >
                Show inline
              </Button>
            ) : null}
            <Button size="sm" tone="primary" disabled={!oneOlderThanNow && chosen.length < 2} onClick={compare}>
              Compare
            </Button>
          </div>
          <div className="border-t border-line-soft px-4 py-2">
            <button
              type="button"
              onClick={() => {
                changes.markAsUnseen();
                setOpen(false);
              }}
              className="text-meta font-medium text-ink-64 hover:text-ink"
            >
              Mark as unseen
            </button>
          </div>
        </div>
      ) : null}
      {comparing ? (
        <SnapshotDiffDialog
          docPath={changes.docPath}
          currentRaw={changes.raw}
          from={comparing.from}
          to={comparing.to}
          onClose={() => setComparing(null)}
        />
      ) : null}
    </div>
  );
}
