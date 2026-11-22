import type { DocMoveItem, DocMovesRound, RoundOutcome } from "@timthink/server";
import { Button } from "../components/Button";
import { SectionHeading } from "../components/PageHeader";
import { docHref } from "../lib/routes";
import { type ItemDraft, withOption, withOther } from "./itemDraft";
import { type DraftChange, OutcomeChip, roundItemElementId, roundOtherElementId } from "./PrCommentItemCard";

export interface DocMoveGroupsProps {
  round: DocMovesRound;
  draftOf: (item: DocMoveItem) => ItemDraft;
  editable: boolean;
  activeIndex: number;
  onActivate: (index: number) => void;
  onChange: (item: DocMoveItem, change: DraftChange) => void;
  onAcceptProposals: (items: DocMoveItem[]) => void;
}

export function DocMoveGroups({
  round,
  draftOf,
  editable,
  activeIndex,
  onActivate,
  onChange,
  onAcceptProposals,
}: DocMoveGroupsProps) {
  return (
    <div className="flex flex-col gap-10">
      {proposedGroups(round).map(({ target, items }) => {
        const proposal = round.projects.find((project) => project.id === target);
        const summary = [proposal?.title, proposal?.repos.join(", "), proposal?.status].filter(Boolean).join(" · ");
        return (
          <section key={target ?? "leave"} aria-label={target ?? "Leave in place"}>
            <SectionHeading aside={`${items.length} doc${items.length === 1 ? "" : "s"}`}>
              {target ?? "Leave in place"}
            </SectionHeading>
            <div className="mb-3 flex items-start gap-3">
              <p className="m-0 min-w-0 flex-1 text-meta text-ink-64">
                {summary}
                {proposal?.summary ? <span className="block">{proposal.summary}</span> : null}
              </p>
              {editable ? (
                <Button size="sm" tone="ghost" onClick={() => onAcceptProposals(items)}>
                  Accept all
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col divide-y divide-line-soft rounded-card border border-line bg-surface">
              {items.map((item) => {
                const index = round.items.indexOf(item);
                return (
                  <DocMoveRow
                    key={item.id}
                    item={item}
                    index={index}
                    draft={draftOf(item)}
                    outcome={round.outcomes[item.id] ?? null}
                    editable={editable}
                    active={editable && index === activeIndex}
                    onActivate={() => onActivate(index)}
                    onChange={(change) => onChange(item, change)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function proposedTarget(item: DocMoveItem) {
  return item.options[0]?.target ?? null;
}

function proposedGroups(round: DocMovesRound) {
  const groups = new Map<string | null, DocMoveItem[]>();
  for (const item of round.items) {
    const target = proposedTarget(item);
    groups.set(target, [...(groups.get(target) ?? []), item]);
  }
  return [...groups]
    .map(([target, items]) => ({ target, items }))
    .sort(
      (a, b) => Number(a.target === null) - Number(b.target === null) || (a.target ?? "").localeCompare(b.target ?? ""),
    );
}

interface DocMoveRowProps {
  item: DocMoveItem;
  index: number;
  draft: ItemDraft;
  outcome: RoundOutcome | null;
  editable: boolean;
  active: boolean;
  onActivate: () => void;
  onChange: (change: DraftChange) => void;
}

function DocMoveRow({ item, index, draft, outcome, editable, active, onActivate, onChange }: DocMoveRowProps) {
  const { selection } = draft;
  return (
    <article
      id={roundItemElementId(item.id)}
      onFocusCapture={onActivate}
      onMouseDown={onActivate}
      className={`scroll-mt-24 px-4 py-3 ${active ? "bg-accent-soft/40" : ""}`}
    >
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-ui">
        <span className="font-mono text-meta text-ink-32 tabular-nums">#{index + 1}</span>
        <a href={docHref(item.doc)} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
          {item.title || item.doc}
        </a>
        {item.status ? <span className="chip chip-neutral">{item.status}</span> : null}
        <span className="font-mono text-meta text-ink-32">{item.doc}</span>
        {outcome ? <OutcomeChip outcome={outcome} /> : null}
      </header>
      {item.reason ? <p className="m-0 mt-1 text-meta text-ink-64">{item.reason}</p> : null}
      <fieldset className="m-0 mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 border-0 p-0" disabled={!editable}>
        <legend className="sr-only">Where it goes</legend>
        {item.options.map((option, position) => {
          const checked = selection?.kind === "option" && selection.optionId === option.id;
          return (
            <label
              key={option.id}
              title={option.hint || undefined}
              className={`flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1 text-meta ${
                checked ? "bg-accent-soft text-ink" : "text-ink-64 hover:bg-bg/60"
              }`}
            >
              <input
                type="radio"
                name={`decision-${item.id}`}
                checked={checked}
                onChange={() => onChange({ draft: withOption(item, draft, option.id), typing: false })}
              />
              <span className={option.target ? "font-mono" : ""}>{option.label}</span>
              <span className="font-mono text-[11px] text-ink-32">{position + 1}</span>
            </label>
          );
        })}
        <label
          className={`flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1 text-meta ${
            selection?.kind === "other" ? "bg-accent-soft text-ink" : "text-ink-64 hover:bg-bg/60"
          }`}
        >
          <input
            type="radio"
            name={`decision-${item.id}`}
            checked={selection?.kind === "other"}
            onChange={() => onChange({ draft: withOther(item, draft), typing: false })}
          />
          Other
          <span className="font-mono text-[11px] text-ink-32">{item.options.length + 1}</span>
        </label>
        {selection?.kind === "other" ? (
          <input
            id={roundOtherElementId(item.id)}
            value={draft.otherText}
            onChange={(event) => onChange({ draft: { ...draft, otherText: event.target.value }, typing: true })}
            placeholder="area/project"
            className="field w-56 py-1 font-mono text-meta"
          />
        ) : null}
      </fieldset>
    </article>
  );
}
