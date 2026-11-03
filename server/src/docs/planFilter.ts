import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

export const IGNORE_FILE = ".timthinkignore";
const AGENT_INSTRUCTION_FILES: ReadonlySet<string> = new Set([
  "agents.md",
  "claude.md",
  "claude.local.md",
  "gemini.md",
]);

async function loadIgnore(file: string): Promise<Ignore | null> {
  const text = await readFile(file, "utf8").catch(() => null);
  return text === null ? null : ignore().add(text);
}

export class PlanFilter {
  private constructor(
    private readonly rootRules: Ignore | null,
    private readonly repoRules: ReadonlyMap<string, Ignore>,
  ) {}

  static async load(docsRoot: string): Promise<PlanFilter> {
    const repos = await readdir(docsRoot, { withFileTypes: true }).catch(() => []);
    const repoRules = new Map<string, Ignore>();
    await Promise.all(
      repos
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map(async (entry) => {
          const rules = await loadIgnore(path.join(docsRoot, entry.name, IGNORE_FILE));
          if (rules) repoRules.set(entry.name, rules);
        }),
    );
    return new PlanFilter(await loadIgnore(path.join(docsRoot, IGNORE_FILE)), repoRules);
  }

  static none(): PlanFilter {
    return new PlanFilter(null, new Map());
  }

  isPlan(relPath: string): boolean {
    if (AGENT_INSTRUCTION_FILES.has(path.posix.basename(relPath).toLowerCase())) return false;
    if (this.rootRules?.ignores(relPath)) return false;
    const [repo, ...rest] = relPath.split("/");
    const repoRules = repo ? this.repoRules.get(repo) : undefined;
    return !(repoRules && rest.length > 0 && repoRules.ignores(rest.join("/")));
  }
}

export function isIgnoreFile(relPath: string): boolean {
  return path.posix.basename(relPath) === IGNORE_FILE;
}
