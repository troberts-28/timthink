import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../reviews/atomicWrite.js";

export const PREFERENCES_FILE = "preferences.json";

const preferencesSchema = z.object({
  hiddenRepos: z.array(z.string()).default([]),
});

export type Preferences = z.infer<typeof preferencesSchema>;

export class PreferencesStore {
  private state: Preferences = { hiddenRepos: [] };
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly stateDir: string) {}

  get filePath(): string {
    return path.join(this.stateDir, PREFERENCES_FILE);
  }

  async load(): Promise<void> {
    const raw = await readFile(this.filePath, "utf8").catch(() => null);
    if (raw === null) return;
    try {
      const parsed = preferencesSchema.safeParse(JSON.parse(raw));
      if (parsed.success) this.state = parsed.data;
    } catch {}
  }

  isRepoHidden(repo: string): boolean {
    return this.state.hiddenRepos.includes(repo);
  }

  async setRepoHidden(repo: string, hidden: boolean): Promise<boolean> {
    if (this.isRepoHidden(repo) === hidden) return false;
    const others = this.state.hiddenRepos.filter((name) => name !== repo);
    this.state = { ...this.state, hiddenRepos: hidden ? [...others, repo].sort() : others };
    await this.persist();
    return true;
  }

  private persist(): Promise<void> {
    const contents = `${JSON.stringify(this.state, null, 2)}\n`;
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await mkdir(this.stateDir, { recursive: true });
        await writeFileAtomic(this.filePath, contents);
      });
    return this.writing;
  }
}
