import { cp, mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TimthinkConfig } from "../config.js";

export const FIXTURE_DOCS = fileURLToPath(new URL("../../../fixtures/agent-docs", import.meta.url));
export const FIXTURE_CLAUDE_PROJECTS = fileURLToPath(new URL("../../../fixtures/claude-projects", import.meta.url));

export async function makeTempDir(prefix = "timthink-test-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function copyFixtureDocs(): Promise<string> {
  const root = path.join(await makeTempDir(), "agent-docs");
  await cp(FIXTURE_DOCS, root, { recursive: true });
  await mkdir(path.join(root, "garden-app", "node_modules", "leftpad"), { recursive: true });
  await writeFile(path.join(root, "garden-app", "node_modules", "leftpad", "README.md"), "# ignored\n");
  await writeFile(path.join(root, "garden-app", ".DS_Store"), "junk");
  const scratchTime = new Date(Date.UTC(2026, 0, 5));
  await utimes(path.join(root, "acme-api", "untitled-scratch.md"), scratchTime, scratchTime);
  return root;
}

export function testConfig(overrides: Partial<TimthinkConfig>): TimthinkConfig {
  return {
    configPath: "/nonexistent/config.json",
    configFound: false,
    stateDir: "/nonexistent/state",
    port: 7420,
    docsRoot: "/nonexistent/docs",
    codeRoot: "/nonexistent/code",
    claudeProjectsDir: "/nonexistent/claude-projects",
    warpTabConfigDir: "/nonexistent/warp-tab-configs",
    userName: "Test Reviewer",
    launchdLabel: "dev.timthink.test",
    repos: {},
    ...overrides,
  };
}

export interface ClaudeProjectsRoots {
  docsRoot: string;
  codeRoot: string;
}

export async function copyClaudeProjects({ docsRoot, codeRoot }: ClaudeProjectsRoots): Promise<string> {
  const target = path.join(await makeTempDir("timthink-claude-"), "projects");
  for (const project of await readdir(FIXTURE_CLAUDE_PROJECTS)) {
    await mkdir(path.join(target, project), { recursive: true });
    for (const file of await readdir(path.join(FIXTURE_CLAUDE_PROJECTS, project))) {
      const text = await readFile(path.join(FIXTURE_CLAUDE_PROJECTS, project, file), "utf8");
      const filled = text.replaceAll("{{DOCS_ROOT}}", docsRoot).replaceAll("{{CODE_ROOT}}", codeRoot);
      await writeFile(path.join(target, project, file), filled);
    }
  }
  return target;
}
