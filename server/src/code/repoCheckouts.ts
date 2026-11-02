import path from "node:path";
import type { TimthinkConfig } from "../config.js";
import { isInside } from "../safePath.js";

function escapeRegExp(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

export function globToRegExp(glob: string): RegExp {
  const pattern = [...glob]
    .map((char) => {
      if (char === "*") return "[^/]*";
      if (char === "?") return "[^/]";
      return escapeRegExp(char);
    })
    .join("");
  return new RegExp(`^${pattern}$`);
}

export function hostCheckout(config: TimthinkConfig, repo: string): string {
  return config.repos[repo]?.host ?? path.join(config.codeRoot, repo);
}

function matchesWorktreeGlob(glob: string, cwd: string): boolean {
  const depth = path.resolve(glob).split("/").length;
  const prefix = cwd.split("/").slice(0, depth).join("/");
  return globToRegExp(path.resolve(glob)).test(prefix);
}

export function isCheckoutOfRepo(config: TimthinkConfig, repo: string, cwd: string): boolean {
  if (!path.isAbsolute(cwd)) return false;
  const normalised = path.resolve(cwd);
  const host = hostCheckout(config, repo);
  if (normalised === host || isInside(host, normalised)) return true;
  const worktrees = config.repos[repo]?.worktrees;
  return worktrees ? matchesWorktreeGlob(worktrees, normalised) : false;
}
