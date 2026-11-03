import path from "node:path";
import type { TimthinkConfig } from "../config.js";
import { runGit } from "./git.js";
import { hostCheckout } from "./repoCheckouts.js";

export interface Worktree {
  path: string;
  branch: string | null;
}

const CACHE_MS = 30_000;

export function parseWorktreeList(porcelain: string): Worktree[] {
  return porcelain
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n");
      const worktree = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
      const ref = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length) ?? null;
      return worktree ? { path: worktree, branch: ref?.replace(/^refs\/heads\//, "") ?? null } : null;
    })
    .filter((entry): entry is Worktree => entry !== null);
}

export class WorktreeIndex {
  private readonly cache = new Map<string, { at: number; worktrees: Promise<Worktree[]> }>();

  constructor(private readonly config: TimthinkConfig) {}

  async forBranch(repo: string, branch: string): Promise<{ path: string; name: string } | null> {
    const match = (await this.list(repo)).find((worktree) => worktree.branch === branch);
    return match ? { path: match.path, name: path.basename(match.path) } : null;
  }

  private list(repo: string): Promise<Worktree[]> {
    const cached = this.cache.get(repo);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.worktrees;
    const worktrees = runGit(hostCheckout(this.config, repo), ["worktree", "list", "--porcelain"]).then((output) =>
      output ? parseWorktreeList(output) : [],
    );
    this.cache.set(repo, { at: Date.now(), worktrees });
    return worktrees;
  }
}
