import { useQueries } from "@tanstack/react-query";
import type { PrInfo } from "@timthink/server";
import type { Element, Root } from "hast";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { lookupPrs } from "../api/prs";
import { queryKeys } from "../api/queries";

const PR_HREF = [
  /app\.graphite\.(?:com|dev)\/github\/pr\/([\w.-]+)\/([\w.-]+)\/(\d+)/,
  /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/,
];

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export function prRefFromHref(href: string): PrRef | null {
  for (const pattern of PR_HREF) {
    const match = pattern.exec(href);
    if (match?.[1] && match[2] && match[3]) return { owner: match[1], repo: match[2], number: Number(match[3]) };
  }
  return null;
}

function refKey({ owner, repo, number }: PrRef): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
}

function collectPrRefs(node: Root | Element, into: Map<string, PrRef>): Map<string, PrRef> {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    const href = child.properties.href;
    if (child.tagName === "a" && child.properties.dataPr !== undefined && typeof href === "string") {
      const ref = prRefFromHref(href);
      if (ref) into.set(refKey(ref), ref);
    }
    collectPrRefs(child, into);
  }
  return into;
}

const PrStatusContext = createContext<ReadonlyMap<string, PrInfo>>(new Map());

export function PrStatusProvider({ hast, children }: { hast: Root | null; children: ReactNode }) {
  const groups = useMemo(() => {
    const byRepo = new Map<string, { owner: string; repo: string; numbers: number[] }>();
    for (const ref of hast ? collectPrRefs(hast, new Map()).values() : []) {
      const key = `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}`;
      const group = byRepo.get(key) ?? { owner: ref.owner, repo: ref.repo, numbers: [] };
      group.numbers.push(ref.number);
      byRepo.set(key, group);
    }
    return [...byRepo.values()].map((group) => ({ ...group, numbers: group.numbers.sort((a, b) => a - b) }));
  }, [hast]);
  const results = useQueries({
    queries: groups.map((group) => ({
      queryKey: queryKeys.prLookup(group.owner, group.repo, group.numbers.join(",")),
      queryFn: () => lookupPrs(group.owner, group.repo, group.numbers),
      staleTime: 60_000,
    })),
  });
  const statuses = useMemo(() => {
    const map = new Map<string, PrInfo>();
    for (const result of results) {
      for (const info of result.data?.prs ?? []) map.set(refKey(info), info);
    }
    return map;
  }, [results]);
  return <PrStatusContext.Provider value={statuses}>{children}</PrStatusContext.Provider>;
}

export function usePrStatus(href: string | undefined): PrInfo | null {
  const statuses = useContext(PrStatusContext);
  const ref = href ? prRefFromHref(href) : null;
  return ref ? (statuses.get(refKey(ref)) ?? null) : null;
}
