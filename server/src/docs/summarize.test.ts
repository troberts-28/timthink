import { describe, expect, it } from "vitest";
import { countTasks, firstHeading, summarizeDoc, titleFromFilename } from "./summarize.js";

const MTIME = Date.UTC(2026, 0, 5);

describe("summarizeDoc", () => {
  it("uses frontmatter fields when present", () => {
    const summary = summarizeDoc({
      path: "acme/plans/2026-10-01-x.md",
      raw: "---\ntitle: Hello\nstatus: Review\ndate: 2026-09-30\npr: 4211\nbranch: feat/x\nlinear: API-1\n---\n# Ignored\n",
      mtime: MTIME,
    });
    expect(summary).toMatchObject({
      repo: "acme",
      project: "plans",
      relPath: "plans/2026-10-01-x.md",
      title: "Hello",
      status: "review",
      date: "2026-09-30",
      prs: ["4211"],
      branch: "feat/x",
      linear: "API-1",
      frontmatterError: null,
    });
  });

  it("falls back to the first heading and the filename date", () => {
    const summary = summarizeDoc({ path: "acme/2026-10-02-notes.md", raw: "intro\n\n# Real title\n", mtime: MTIME });
    expect(summary).toMatchObject({ title: "Real title", date: "2026-10-02", project: null, status: null });
  });

  it("falls back to the filename and mtime", () => {
    const summary = summarizeDoc({ path: "acme/untitled-scratch.md", raw: "no heading", mtime: MTIME });
    expect(summary).toMatchObject({ title: "Untitled scratch", date: "2026-01-05" });
  });

  it("survives malformed YAML", () => {
    const summary = summarizeDoc({
      path: "acme/2026-08-02-broken.md",
      raw: "---\ntitle: [unclosed\n---\n\n# From heading\n",
      mtime: MTIME,
    });
    expect(summary?.title).toBe("From heading");
    expect(summary?.frontmatterError).toBeTruthy();
  });

  it("lets frontmatter override the folder project", () => {
    const summary = summarizeDoc({ path: "garden/plans/a.md", raw: "---\nproject: hardware\n---\n", mtime: MTIME });
    expect(summary?.project).toBe("hardware");
  });

  it("ignores a frontmatter project that just repeats the repo name", () => {
    const atRoot = summarizeDoc({ path: "timthink/plan.md", raw: "---\nproject: timthink\n---\n", mtime: MTIME });
    expect(atRoot?.project).toBeNull();
    const inFolder = summarizeDoc({ path: "timthink/ui/plan.md", raw: "---\nproject: timthink\n---\n", mtime: MTIME });
    expect(inFolder?.project).toBe("ui");
  });

  it("reads pr as a number, a list, or PR URLs", () => {
    const prs = (value: string) => summarizeDoc({ path: "acme/p.md", raw: `---\npr: ${value}\n---\n`, mtime: 0 })?.prs;
    expect(prs("4211")).toEqual(["4211"]);
    expect(prs("[27269, '#27270']")).toEqual(["27269", "27270"]);
    expect(prs("https://github.com/o/r/pull/12")).toEqual(["12"]);
    expect(prs("https://app.graphite.com/github/pr/o/r/34")).toEqual(["34"]);
    expect(prs('""')).toEqual([]);
    expect(prs("soon")).toEqual([]);
  });

  it("rejects files outside a repo folder", () => {
    expect(summarizeDoc({ path: "top-level.md", raw: "", mtime: MTIME })).toBeNull();
  });
});

describe("countTasks", () => {
  it("counts done and open task items, ignoring fenced code", () => {
    const body = "- [x] one\n- [ ] two\n  * [X] nested\n1. [ ] numbered\n```\n- [ ] in code\n```\n- not a task\n";
    expect(countTasks(body)).toEqual({ done: 2, total: 4 });
  });
});

describe("firstHeading", () => {
  it("skips headings inside code fences", () => {
    expect(firstHeading("```\n# not this\n```\n# This one #\n")).toBe("This one");
  });
});

describe("titleFromFilename", () => {
  it("strips the date prefix and humanises the slug", () => {
    expect(titleFromFilename("2026-10-22-journeys-roadmap.md")).toBe("Journeys roadmap");
  });
});
