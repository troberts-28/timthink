import { describe, expect, it } from "vitest";
import type { RepoGroupConfig } from "../config.js";
import { FALLBACK_GROUP, groupForRepo, groupNames } from "./repoGroups.js";

const work: RepoGroupConfig = { name: "Work", owners: ["acme-corp"], repos: ["side-tool"], default: false };
const personal: RepoGroupConfig = { name: "Personal", owners: [], repos: [], default: true };
const groups = [work, personal];

describe("groupForRepo", () => {
  it("returns null when no groups are configured", () => {
    expect(groupForRepo(null, "api", { owner: "acme-corp", repo: "api" })).toBeNull();
  });

  it("matches the GitHub owner case-insensitively", () => {
    expect(groupForRepo(groups, "api", { owner: "Acme-Corp", repo: "api" })).toBe("Work");
  });

  it("prefers an explicit repo listing over the owner", () => {
    expect(groupForRepo(groups, "side-tool", { owner: "someone", repo: "side-tool" })).toBe("Work");
    const explicitPersonal = [work, { ...personal, repos: ["api"] }];
    expect(groupForRepo(explicitPersonal, "api", { owner: "acme-corp", repo: "api" })).toBe("Personal");
  });

  it("falls back to the default group, then to Other", () => {
    expect(groupForRepo(groups, "notes", null)).toBe("Personal");
    const noDefault = groups.map((group) => ({ ...group, default: false }));
    expect(groupForRepo(noDefault, "notes", null)).toBe(FALLBACK_GROUP);
  });
});

describe("groupNames", () => {
  it("keeps configured order and appends the fallback group when used", () => {
    expect(groupNames(groups, ["Personal", "Work"])).toEqual(["Work", "Personal"]);
    expect(groupNames(groups, ["Other", null])).toEqual(["Work", "Personal", "Other"]);
  });
});
