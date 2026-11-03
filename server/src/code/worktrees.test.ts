import { describe, expect, it } from "vitest";
import { parseWorktreeList } from "./worktrees.js";

describe("parseWorktreeList", () => {
  it("reads paths and branches, including detached worktrees", () => {
    const output = [
      "worktree /code/repo\nHEAD abc\nbranch refs/heads/main",
      "worktree /code/repo-4\nHEAD def\nbranch refs/heads/feat/x",
      "worktree /code/repo-5\nHEAD 123\ndetached",
      "",
    ].join("\n\n");
    expect(parseWorktreeList(output)).toEqual([
      { path: "/code/repo", branch: "main" },
      { path: "/code/repo-4", branch: "feat/x" },
      { path: "/code/repo-5", branch: null },
    ]);
  });
});
