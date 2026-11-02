import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeTempDir } from "./fixtures.js";

export const SAMPLE_CODE_FILES = [
  "src/middleware/rateLimit.ts",
  "src/auth/refresh.ts",
  "src/auth/tokens.ts",
  "lib/tokens.ts",
  "config/limits.json",
  "scripts/load/burst.js",
];

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    encoding: "utf8",
  });
}

export async function createGitRepo(
  name = "acme-api",
  files = SAMPLE_CODE_FILES,
): Promise<{ codeRoot: string; checkout: string }> {
  const codeRoot = await makeTempDir("timthink-code-");
  const checkout = path.join(codeRoot, name);
  for (const file of files) {
    await mkdir(path.dirname(path.join(checkout, file)), { recursive: true });
    await writeFile(path.join(checkout, file), `// ${file}\n`);
  }
  git(checkout, "init", "-q", "-b", "main");
  git(checkout, "remote", "add", "origin", `git@github.com:acme/${name}.git`);
  git(checkout, "add", ".");
  git(checkout, "commit", "-q", "-m", "init");
  return { codeRoot, checkout };
}
