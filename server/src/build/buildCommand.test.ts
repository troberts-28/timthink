import { describe, expect, it } from "vitest";
import {
  buildRequestInPrompt,
  buildShellCommand,
  buildSlashCommand,
  isValidBranchName,
  parseBuildArgs,
  suggestBranch,
} from "./buildCommand.js";

describe("buildSlashCommand", () => {
  it("formats the doc with optional phase and branch", () => {
    expect(buildSlashCommand({ doc: "repo/plan.md" })).toBe("/timthink build repo/plan.md");
    expect(buildSlashCommand({ doc: "repo/plan.md", phase: 2, branch: "feat/x" })).toBe(
      "/timthink build repo/plan.md --phase 2 --branch feat/x",
    );
  });

  it("quotes docs with spaces so they round-trip", () => {
    const command = buildSlashCommand({ doc: 'repo/my "odd" plan.md' });
    expect(command).toBe('/timthink build "repo/my \\"odd\\" plan.md"');
    expect(parseBuildArgs(command.replace("/timthink ", ""))).toEqual({
      doc: 'repo/my "odd" plan.md',
      phase: null,
      branch: null,
    });
  });
});

describe("buildShellCommand", () => {
  it("prefixes a cd into the planner's directory and single-quotes for the shell", () => {
    expect(buildShellCommand({ doc: "repo/plan.md", phase: 1 }, "/Users/me/code/it's here")).toBe(
      "cd '/Users/me/code/it'\\''s here' && claude '/timthink build repo/plan.md --phase 1'",
    );
  });

  it("omits the cd without a directory", () => {
    expect(buildShellCommand({ doc: "repo/plan.md" }, null)).toBe("claude '/timthink build repo/plan.md'");
  });
});

describe("suggestBranch", () => {
  it("drops the date prefix and extension", () => {
    expect(suggestBranch("monorepo/2026-11-03-timthink-v2-prs-and-stacks.md")).toBe("feat/timthink-v2-prs-and-stacks");
  });

  it("keeps the name short and git-safe", () => {
    const branch = suggestBranch(`repo/${"Very Long Name ".repeat(10)}.md`);
    expect(isValidBranchName(branch)).toBe(true);
    expect(branch.length).toBeLessThanOrEqual(53);
  });
});

describe("isValidBranchName", () => {
  it.each(["feat/x", "fix/a.b_c-1", "main"])("accepts %s", (name) => expect(isValidBranchName(name)).toBe(true));
  it.each(["-x", "a..b", "a//b", "a/", "a.lock", "a b", "a;rm", "x@{1}", ""])("rejects %s", (name) =>
    expect(isValidBranchName(name)).toBe(false),
  );
});

describe("buildRequestInPrompt", () => {
  it("reads a slash command as Claude Code records it", () => {
    const content =
      "<command-message>timthink</command-message>\n<command-name>/timthink</command-name>\n<command-args>build timthink/plan.md --phase 3</command-args>";
    expect(buildRequestInPrompt(content)).toEqual({ doc: "timthink/plan.md", phase: 3, branch: null });
  });

  it("reads a typed command", () => {
    expect(buildRequestInPrompt("/timthink build ~/docs/r/p.md --branch feat/p")).toEqual({
      doc: "~/docs/r/p.md",
      phase: null,
      branch: "feat/p",
    });
  });

  it("ignores reviews and other commands", () => {
    expect(
      buildRequestInPrompt("<command-name>/timthink</command-name>\n<command-args>review r/p.md</command-args>"),
    ).toBeNull();
    expect(
      buildRequestInPrompt("<command-name>/other</command-name>\n<command-args>build r/p.md</command-args>"),
    ).toBeNull();
    expect(buildRequestInPrompt("please build r/p.md")).toBeNull();
  });

  it("drops an invalid branch rather than trusting it", () => {
    expect(parseBuildArgs("build r/p.md --branch 'a;rm -rf'")).toEqual({ doc: "r/p.md", phase: null, branch: null });
  });
});
