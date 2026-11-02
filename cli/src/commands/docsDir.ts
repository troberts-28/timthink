import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { TimthinkConfig } from "@timthink/server";

const execFileAsync = promisify(execFile);

export type FolderMatch = "exact" | "alias" | "worktree-prefix" | "none";

export interface FolderResolution {
  folder: string;
  match: FolderMatch;
}

export function resolveDocsFolder(
  repoName: string,
  existingFolders: readonly string[],
  aliases: Readonly<Record<string, readonly string[]>>,
): FolderResolution {
  if (existingFolders.includes(repoName)) return { folder: repoName, match: "exact" };
  const aliased = Object.entries(aliases).find(([, names]) => names.includes(repoName))?.[0];
  if (aliased) return { folder: aliased, match: "alias" };
  const prefixed = existingFolders
    .filter((folder) => repoName.startsWith(`${folder}-`))
    .sort((a, b) => b.length - a.length)[0];
  if (prefixed) return { folder: prefixed, match: "worktree-prefix" };
  return { folder: repoName, match: "none" };
}

export async function gitToplevel(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function docsFolders(docsRoot: string): Promise<string[]> {
  const entries = await readdir(docsRoot, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name);
}

export interface DocsDir {
  dir: string;
  exists: boolean;
  repoName: string;
  match: FolderMatch;
}

export async function findDocsDir(config: Pick<TimthinkConfig, "docsRoot" | "repos">, cwd: string): Promise<DocsDir> {
  const repoName = path.basename((await gitToplevel(cwd)) ?? path.resolve(cwd));
  const folders = await docsFolders(config.docsRoot);
  const aliases = Object.fromEntries(Object.entries(config.repos).map(([name, repo]) => [name, repo.aliases ?? []]));
  const { folder, match } = resolveDocsFolder(repoName, folders, aliases);
  return {
    dir: path.join(config.docsRoot, folder),
    exists: folders.includes(folder),
    repoName,
    match,
  };
}
