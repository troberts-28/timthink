import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GithubRepo } from "../docs/types.js";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 256 * 1024 * 1024;

export async function runGit(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
      maxBuffer: GIT_MAX_BUFFER,
      encoding: "utf8",
    });
    return stdout;
  } catch {
    return null;
  }
}

export async function readHead(checkout: string): Promise<string | null> {
  return (await runGit(checkout, ["rev-parse", "HEAD"]))?.trim() || null;
}

export interface CheckoutHead {
  toplevel: string;
  branch: string;
}

export async function readCheckoutHead(cwd: string): Promise<CheckoutHead | null> {
  const output = await runGit(cwd, ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"]);
  const [toplevel, branch] = (output ?? "").trim().split("\n");
  return toplevel && branch ? { toplevel, branch } : null;
}

export async function listTrackedFiles(checkout: string): Promise<string[]> {
  const output = await runGit(checkout, ["ls-files", "-z"]);
  return output ? output.split("\0").filter(Boolean) : [];
}

const GITHUB_REMOTE_PATTERNS: readonly RegExp[] = [
  /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  /^ssh:\/\/git@github\.com(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  /^https?:\/\/(?:[^@/\s]+@)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
];

export function parseGithubRemote(url: string): GithubRepo | null {
  const trimmed = url.trim();
  for (const pattern of GITHUB_REMOTE_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match?.[1] && match[2]) return { owner: match[1], repo: match[2] };
  }
  return null;
}

export async function readGithubRemote(checkout: string): Promise<GithubRepo | null> {
  const url = await runGit(checkout, ["remote", "get-url", "origin"]);
  return url ? parseGithubRemote(url) : null;
}
