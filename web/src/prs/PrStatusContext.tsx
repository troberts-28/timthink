import { useQueries } from "@tanstack/react-query";
import type { PrInfo } from "@timthink/server";
import type { Element, Root } from "hast";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { lookupPrs } from "../api/prs";
import { queryKeys } from "../api/queries";
import { type PrRef, prRefFromHref, prRefKey } from "./prRefs";

function collectPrRefs(node: Root | Element, into: Map<string, PrRef>): Map<string, PrRef> {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    const href = child.properties.href;
    if (child.tagName === "a" && child.properties.dataPr !== undefined && typeof href === "string") {
      const ref = prRefFromHref(href);
      if (ref) into.set(prRefKey(ref), ref);
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
      for (const info of result.data?.prs ?? []) map.set(prRefKey(info), info);
    }
    return map;
  }, [results]);
  return <PrStatusContext.Provider value={statuses}>{children}</PrStatusContext.Provider>;
}

export function usePrStatus(href: string | undefined): PrInfo | null {
  const statuses = useContext(PrStatusContext);
  const ref = href ? prRefFromHref(href) : null;
  return ref ? (statuses.get(prRefKey(ref)) ?? null) : null;
}

function allMerged(statuses: ReadonlyMap<string, PrInfo>, keys: readonly string[]): boolean {
  return keys.length > 0 && keys.every((key) => statuses.get(key)?.state === "merged");
}

export function useTaskMerged(taskPrs: string | undefined): boolean {
  const statuses = useContext(PrStatusContext);
  return taskPrs ? allMerged(statuses, taskPrs.split(" ")) : false;
}

function openTaskPrLists(node: Root | Element, into: string[][]): string[][] {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    const taskPrs = child.properties.dataTaskPrs;
    if (typeof taskPrs === "string") into.push(taskPrs.split(" "));
    openTaskPrLists(child, into);
  }
  return into;
}

export function useMergedOpenTaskCount(hast: Root | null): number {
  const statuses = useContext(PrStatusContext);
  const lists = useMemo(() => (hast ? openTaskPrLists(hast, []) : []), [hast]);
  return lists.filter((keys) => allMerged(statuses, keys)).length;
}
