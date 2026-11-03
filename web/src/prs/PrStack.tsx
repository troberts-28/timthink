import { useQueryClient } from "@tanstack/react-query";
import type { DocPrsResponse, PrInfo, PrLinkHost, StackItem } from "@timthink/server";
import { ChevronLeft, ExternalLink, GitPullRequest, RefreshCw, RotateCcw, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { refreshDocPrs, setPrUnlinked } from "../api/prs";
import { queryKeys, useDocPrs } from "../api/queries";
import { relativeTime } from "../lib/format";
import { useToast } from "../lib/toast";
import { prUrl } from "../markdown/linkPatterns";
import { PrCard, PrSignals, PrStateDot } from "./PrVisuals";

interface PrStackProps {
  docPath: string;
  prLinks: PrLinkHost;
  fallback: ReactNode;
}

function itemsToShow(data: DocPrsResponse): StackItem[] {
  if (data.stack.length > 0) return data.stack;
  return data.linked.map((pr) => ({ number: pr.number, linked: true, info: pr.info }));
}

const CONTEXT_RUN_SHOWN = 1;
const CONTEXT_RUN_COLLAPSE_AT = 3;

type Segment = { kind: "pr"; item: StackItem } | { kind: "more"; numbers: number[] };

function segments(items: readonly StackItem[], expanded: boolean): Segment[] {
  if (expanded) return items.map((item) => ({ kind: "pr", item }));
  const result: Segment[] = [];
  let run: StackItem[] = [];
  const flush = () => {
    if (run.length >= CONTEXT_RUN_COLLAPSE_AT) {
      result.push(...run.slice(0, CONTEXT_RUN_SHOWN).map((item) => ({ kind: "pr" as const, item })));
      result.push({ kind: "more", numbers: run.slice(CONTEXT_RUN_SHOWN).map((item) => item.number) });
    } else {
      result.push(...run.map((item) => ({ kind: "pr" as const, item })));
    }
    run = [];
  };
  for (const item of items) {
    if (item.linked) {
      flush();
      result.push({ kind: "pr", item });
    } else {
      run.push(item);
    }
  }
  flush();
  return result;
}

function topOpenPr(items: readonly StackItem[]): PrInfo | null {
  const open = items.flatMap((item) =>
    item.info && item.info.state !== "merged" && item.info.state !== "closed" ? [item.info] : [],
  );
  return open[open.length - 1] ?? null;
}

function PrPill({ item, href, onUnlink }: { item: StackItem; href: string | null; onUnlink: (() => void) | null }) {
  const { info } = item;
  const closed = info?.state === "closed";
  const label = (
    <>
      <PrStateDot state={info?.state ?? null} />
      <span className={`font-mono text-[11.5px] ${closed ? "line-through" : ""}`}>#{item.number}</span>
      {info ? <PrSignals info={info} /> : null}
    </>
  );
  return (
    <span className={`pr-pill group/pill ${item.linked ? "" : "pr-pill-context"}`}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-1.5">
          {label}
        </a>
      ) : (
        <span className="flex items-center gap-1.5">{label}</span>
      )}
      {info ? <PrCard info={info} /> : null}
      {onUnlink ? (
        <button
          type="button"
          onClick={onUnlink}
          title="Not this plan"
          aria-label={`Unlink #${item.number} from this plan`}
          className="pr-pill-unlink"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

export function PrStack({ docPath, prLinks, fallback }: PrStackProps) {
  const { data } = useDocPrs(docPath);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  if (!data || data.status === "disabled" || data.status === "no-github" || !data.github) return <>{fallback}</>;
  const github = data.github;
  const items = itemsToShow(data);
  if (items.length === 0 && data.unlinked.length === 0) return <>{fallback}</>;

  const update = (next: DocPrsResponse) => queryClient.setQueryData(queryKeys.docPrs(docPath), next);
  const refresh = async () => {
    setRefreshing(true);
    try {
      update(await refreshDocPrs(docPath));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't refresh PRs", "bad");
    } finally {
      setRefreshing(false);
    }
  };
  const setUnlinked = async (number: number, unlinked: boolean) => {
    try {
      update(await setPrUnlinked(docPath, number, unlinked));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't update the plan's PRs", "bad");
    }
  };
  const top = topOpenPr(items);
  return (
    <section className="pr-stack" aria-label="Pull requests">
      <GitPullRequest className="size-3.5 flex-none text-ink-32" aria-hidden />
      {data.trunk ? <span className="font-mono text-[11.5px] text-ink-32">{data.trunk}</span> : null}
      {segments(items, expanded).map((segment, index) => (
        <span key={segment.kind === "pr" ? segment.item.number : `more-${index}`} className="flex items-center gap-1">
          {data.trunk || index > 0 ? <ChevronLeft className="size-3 text-ink-32" aria-hidden /> : null}
          {segment.kind === "pr" ? (
            <PrPill
              item={segment.item}
              href={prUrl(github, String(segment.item.number), prLinks)}
              onUnlink={segment.item.linked ? () => void setUnlinked(segment.item.number, true) : null}
            />
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              title={segment.numbers.map((number) => `#${number}`).join(", ")}
              className="pr-pill pr-pill-context text-meta"
            >
              +{segment.numbers.length} more
            </button>
          )}
        </span>
      ))}
      {data.unlinked.map((number) => (
        <button
          key={number}
          type="button"
          onClick={() => void setUnlinked(number, false)}
          title={`Link #${number} to this plan again`}
          className="flex items-center gap-1 text-meta text-ink-32 hover:text-ink-64"
        >
          <RotateCcw className="size-3" aria-hidden />#{number}
        </button>
      ))}
      <span className="ml-auto flex items-center gap-2 text-meta text-ink-32">
        {prLinks === "graphite" && top ? (
          <a
            href={prUrl(github, String(top.number), "graphite")}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 hover:text-ink-64"
          >
            Stack in Graphite <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
        {data.status === "unavailable" ? (
          <span className="text-bad-ink" title={data.message ?? undefined}>
            gh unavailable
          </span>
        ) : data.asOf ? (
          <span title={new Date(data.asOf).toLocaleString()}>as of {relativeTime(Date.parse(data.asOf))}</span>
        ) : null}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing || data.refreshing}
          aria-label="Refresh PR status"
          title="Refresh PR status"
          className="grid size-6 place-items-center rounded-button hover:bg-bg-sunken hover:text-ink-64 disabled:opacity-60"
        >
          <RefreshCw className={`size-3 ${refreshing || data.refreshing ? "animate-spin" : ""}`} aria-hidden />
        </button>
      </span>
    </section>
  );
}
