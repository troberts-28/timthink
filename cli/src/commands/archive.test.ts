import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_ARCHIVE_SETTINGS, type OfflineArchiveConfig } from "@timthink/server";
import { beforeEach, describe, expect, it } from "vitest";
import { type ArchiveOptions, runArchive } from "./archive.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH = "acme/2026-11-02-fresh.md";
const STALE = "acme/2026-08-01-stale.md";
const DONE = "acme/2026-10-28-done.md";

let config: OfflineArchiveConfig;

async function writePlan(docPath: string, status: string, ageDays: number): Promise<void> {
  const absolute = path.join(config.docsRoot, docPath);
  await writeFile(absolute, `---\nstatus: ${status}\n---\n\n# ${path.basename(docPath, ".md")}\n`);
  const when = new Date(Date.now() - ageDays * DAY_MS);
  await utimes(absolute, when, when);
}

async function cli(command: "archive" | "unarchive", args: string[], options: ArchiveOptions = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runArchive(config, command, args, options, {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "timthink-cli-archive-"));
  config = {
    docsRoot: path.join(root, "docs"),
    stateDir: path.join(root, "state"),
    archive: DEFAULT_ARCHIVE_SETTINGS,
    readOnly: false,
  };
  await mkdir(path.join(config.docsRoot, "acme"), { recursive: true });
  await writePlan(FRESH, "draft", 1);
  await writePlan(STALE, "draft", 40);
  await writePlan(DONE, "done", 5);
});

describe("timthink archive", () => {
  it("prints what the auto rule archives and why, with per-repo counts", async () => {
    const result = await cli("archive", [], { dryRunAuto: true });
    expect(result.code).toBe(0);
    expect(result.out).toContain("acme: 2 of 3 would be auto-archived");
    expect(result.out).toContain("2026-08-01-stale.md\tNot edited for 40 days");
    expect(result.out).toContain("2026-10-28-done.md\tDone 5 days ago");
    expect(result.out).toContain("acme\t3 plans\t2 auto\t0 manual\t1 active");
  });

  it("archives, lists and unarchives a plan", async () => {
    expect((await cli("archive", [FRESH])).out).toBe(`Archived ${FRESH}.`);
    const listed = await cli("archive", [], { list: true });
    expect(listed.out).toContain("acme (3 archived)");
    expect(listed.out).toMatch(/2026-11-02-fresh\.md\tArchived by you today/);

    expect((await cli("unarchive", [STALE])).out).toBe(`Kept ${STALE} active.`);
    const onDisk = JSON.parse(await readFile(path.join(config.docsRoot, "acme/.timthink/archive.json"), "utf8"));
    expect(Object.keys(onDisk.archived)).toEqual(["2026-11-02-fresh.md"]);
    expect(Object.keys(onDisk.keepActive)).toEqual(["2026-08-01-stale.md"]);
    expect((await cli("archive", [], { list: true, repo: "other" })).out).toBe("No archived plans.");
  });

  it("explains when a cleared plan is still auto-archived", async () => {
    await cli("archive", [STALE]);
    expect((await cli("archive", [STALE], { clear: true })).out).toBe(
      `Cleared the archive choice for ${STALE}. (still auto-archived: Not edited for 40 days)`,
    );
  });

  it("rejects unknown plans and refuses to write when read-only", async () => {
    expect((await cli("archive", ["acme/missing.md"])).code).toBe(1);
    config = { ...config, readOnly: true };
    const result = await cli("archive", [FRESH]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("read-only");
  });
});
