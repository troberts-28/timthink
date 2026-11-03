import { describe, expect, it } from "vitest";
import { findTextLinks, isCodePath, prUrlForGithubPull } from "./linkPatterns";

const github = { owner: "acme", repo: "api" };
const noPlans = { github, prLinks: "graphite" as const, hasPlan: () => false };

describe("isCodePath", () => {
  it.each([
    "web/src/components/UpNext/tasks/DefaultUpNext.tsx:42",
    "handleProposalOptInPeriod.ts",
    "src/a.ts:10:4",
    "app/[slug]/(group)/page.tsx",
    "package.json",
    ".github/workflows/ci.yml",
  ])("accepts %s", (value) => {
    expect(isCodePath(value)).toBe(true);
  });

  it.each([
    "e.g.",
    "v1.2.3",
    "1.5",
    "npm run build",
    "https://example.com/a.ts",
    "foo()",
    "--flag.ts",
    "Array.prototype.map",
    "x.unknownext",
  ])("rejects %s", (value) => {
    expect(isCodePath(value)).toBe(false);
  });
});

describe("findTextLinks", () => {
  it.each([
    ["see #19388 for context", "#19388"],
    ["PR 19388 landed", "PR 19388"],
    ["PR #19388 landed", "PR #19388"],
    ["branch pr-19388 exists", "pr-19388"],
  ])("links %s", (text, matched) => {
    const [link] = findTextLinks(text, noPlans);
    expect(link?.kind === "pr" && link.url).toBe("https://app.graphite.com/github/pr/acme/api/19388");
    expect(link && text.slice(link.start, link.end)).toBe(matched);
  });

  it("leaves single-digit stack positions like PR 3 alone", () => {
    expect(findTextLinks("PR 3: wire polling", noPlans)).toEqual([]);
  });

  it("uses the owner and repo from a GitHub pull URL", () => {
    const [link] = findTextLinks("was github.com/other/thing/pull/12 earlier", { ...noPlans, github: null });
    expect(link?.kind === "pr" && link.url).toBe("https://app.graphite.com/github/pr/other/thing/12");
  });

  it("ignores single digits, anchors, entities and repos without a remote", () => {
    expect(findTextLinks("step #1 and page#123 and &#123;", noPlans)).toEqual([]);
    expect(findTextLinks("see #19388", { ...noPlans, github: null })).toEqual([]);
  });

  it("links <repo>#<n> for known repos using that repo's link host", () => {
    const knownRepo = (name: string) =>
      name === "platform"
        ? { github: { owner: "acme", repo: "platform" }, prLinks: "graphite" as const }
        : name === "widgets"
          ? { github: { owner: "acme", repo: "widgets" }, prLinks: "github" as const }
          : null;
    const text = "see platform#4821, widgets#317 and unknown#12";
    const links = findTextLinks(text, { ...noPlans, github: null, knownRepo });
    expect(links.map((link) => link.kind === "pr" && [text.slice(link.start, link.end), link.url])).toEqual([
      ["platform#4821", "https://app.graphite.com/github/pr/acme/platform/4821"],
      ["widgets#317", "https://github.com/acme/widgets/pull/317"],
    ]);
  });

  it("links sibling plan filenames that exist", () => {
    const links = findTextLinks("follows 2026-10-22-journeys-roadmap.md and missing.md", {
      ...noPlans,
      hasPlan: (name) => name === "2026-10-22-journeys-roadmap.md",
    });
    expect(links).toEqual([{ kind: "plan", start: 8, end: 38, fileName: "2026-10-22-journeys-roadmap.md" }]);
  });
});

describe("prUrlForGithubPull", () => {
  it("converts pull URLs and ignores others", () => {
    expect(prUrlForGithubPull("https://github.com/acme/api/pull/7/files", "graphite")).toBeNull();
    expect(prUrlForGithubPull("https://github.com/acme/api/pull/7", "graphite")).toBe(
      "https://app.graphite.com/github/pr/acme/api/7",
    );
    expect(prUrlForGithubPull("https://github.com/acme/api/issues/7", "graphite")).toBeNull();
  });

  it("keeps GitHub links for repos that use GitHub for review", () => {
    expect(prUrlForGithubPull("https://github.com/acme/api/pull/7#discussion", "github")).toBe(
      "https://github.com/acme/api/pull/7",
    );
    const [link] = findTextLinks("see #19388", { ...noPlans, prLinks: "github" });
    expect(link?.kind === "pr" && link.url).toBe("https://github.com/acme/api/pull/19388");
  });
});
