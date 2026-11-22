import type { InboxItem } from "@timthink/server";

export interface SectionSpec {
  kind: InboxItem["kind"];
  title: string;
  hint: string;
}

export const INBOX_SECTIONS: readonly SectionSpec[] = [
  { kind: "round", title: "Rounds awaiting you", hint: "A Claude session is waiting on your decisions" },
  { kind: "question", title: "Open questions", hint: "Plans in review waiting on an answer" },
];

export interface RepoGroup {
  repo: string;
  items: InboxItem[];
}

export function groupByRepo(items: readonly InboxItem[]): RepoGroup[] {
  const groups = new Map<string, InboxItem[]>();
  for (const item of items) groups.set(item.repo, [...(groups.get(item.repo) ?? []), item]);
  return [...groups.entries()]
    .map(([repo, entries]) => ({ repo, items: entries }))
    .sort((a, b) => (b.items[0]?.at ?? "").localeCompare(a.items[0]?.at ?? "") || a.repo.localeCompare(b.repo));
}

export interface GroupedRepos {
  group: string | null;
  repos: RepoGroup[];
}

export function groupRepoSections(
  repos: readonly RepoGroup[],
  groupOrder: readonly string[] | null,
  groupOf: (repo: string) => string | null,
): GroupedRepos[] {
  if (!groupOrder || groupOrder.length === 0) return [{ group: null, repos: [...repos] }];
  const grouped: GroupedRepos[] = groupOrder.map((group) => ({
    group,
    repos: repos.filter((entry) => groupOf(entry.repo) === group),
  }));
  const unplaced = repos.filter((entry) => !groupOrder.includes(groupOf(entry.repo) ?? ""));
  return [...grouped, { group: null, repos: unplaced }].filter((section) => section.repos.length > 0);
}
