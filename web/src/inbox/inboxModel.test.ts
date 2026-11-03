import type { InboxItem } from "@timthink/server";
import { describe, expect, it } from "vitest";
import { groupRepoSections, type RepoGroup } from "./inboxModel";

const NO_ITEMS: InboxItem[] = [];

function repo(name: string): RepoGroup {
  return { repo: name, items: NO_ITEMS };
}

describe("groupRepoSections", () => {
  const groupOf = (name: string) => ({ api: "Work", web: "Work", notes: "Personal" })[name] ?? null;

  it("keeps a single ungrouped section when groups are off", () => {
    expect(groupRepoSections([repo("api"), repo("notes")], null, groupOf)).toEqual([
      { group: null, repos: [repo("api"), repo("notes")] },
    ]);
  });

  it("orders repos under their groups and keeps unknown repos at the end", () => {
    const sections = groupRepoSections(
      [repo("notes"), repo("api"), repo("stray"), repo("web")],
      ["Work", "Personal"],
      groupOf,
    );
    expect(sections.map((section) => [section.group, section.repos.map((entry) => entry.repo)])).toEqual([
      ["Work", ["api", "web"]],
      ["Personal", ["notes"]],
      [null, ["stray"]],
    ]);
  });
});
