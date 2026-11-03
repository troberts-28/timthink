import type { InboxItem, InboxSection } from "@timthink/server";

export interface SectionSpec {
  id: InboxSection;
  title: string;
  hint: string;
}

export const INBOX_SECTIONS: readonly SectionSpec[] = [
  { id: "review", title: "Needs your review", hint: "Plans asking for your input" },
  { id: "replies", title: "Claude replied", hint: "New replies in your threads" },
  { id: "questions", title: "Open questions", hint: "Decisions waiting on an answer" },
  { id: "waiting", title: "Waiting on Claude", hint: "Reviews you've sent" },
  { id: "changed", title: "Changed since you last looked", hint: "Edited in the last 14 days" },
];

export interface ReasonChip {
  label: string;
  className: string;
}

export function reasonChip(item: InboxItem): ReasonChip {
  switch (item.reason) {
    case "review-requested":
      return { label: "Review requested", className: "chip-accent" };
    case "review-addressed":
      return { label: "Your review was addressed", className: "chip-ok-soft" };
    case "claude-replied":
      return { label: item.count === 1 ? "1 reply" : `${item.count} replies`, className: "chip-info" };
    case "open-question":
      return { label: "Unanswered", className: "chip-accent" };
    case "waiting-on-claude":
      return { label: "Review sent", className: "chip-info" };
    case "new":
      return { label: "New plan", className: "chip-ok-soft" };
    case "edited": {
      const by = item.attribution?.kind;
      return {
        label: by === "claude" ? "Edited by Claude" : by === "human" ? "Edited by you" : "Edited",
        className: "chip-neutral",
      };
    }
  }
}

export interface RepoGroup {
  repo: string;
  items: InboxItem[];
}

export function groupByRepo(items: readonly InboxItem[]): RepoGroup[] {
  const groups = new Map<string, InboxItem[]>();
  for (const item of items) groups.set(item.doc.repo, [...(groups.get(item.doc.repo) ?? []), item]);
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
