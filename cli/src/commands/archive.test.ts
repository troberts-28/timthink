import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OfflineArchiveConfig } from "@timthink/server";
import { beforeEach, describe, expect, it } from "vitest";
import { type ArchiveOptions, runArchive } from "./archive.js";

const FRESH = "acme/2026-11-02-first.md";
const STALE = "acme/2026-08-01-second.md";

let config: OfflineArchiveConfig;

async function writePlan(docPath: string): Promise<void> {
  await writeFile(
    path.join(config.docsRoot, docPath),
    `---\nstatus: draft\n---\n\n# ${path.basename(docPath, ".md")}\n`,
  );
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
  config = { docsRoot: path.join(root, "docs"), readOnly: false };
  await mkdir(path.join(config.docsRoot, "acme"), { recursive: true });
  await writePlan(FRESH);
  await writePlan(STALE);
});

describe("timthink archive", () => {
  it("archives, lists and unarchives a plan", async () => {
    expect((await cli("archive", [FRESH])).out).toBe(`Archived ${FRESH}.`);
    const listed = await cli("archive", [], { list: true });
    expect(listed.out).toContain("acme (1 archived)");
    expect(listed.out).toMatch(/2026-11-02-first\.md\tArchived by you today/);

    expect((await cli("unarchive", [STALE])).out).toBe(`Kept ${STALE} active.`);
    const onDisk = JSON.parse(await readFile(path.join(config.docsRoot, "acme/.timthink/archive.json"), "utf8"));
    expect(Object.keys(onDisk.archived)).toEqual(["2026-11-02-first.md"]);
    expect(Object.keys(onDisk.keepActive)).toEqual(["2026-08-01-second.md"]);
    expect((await cli("archive", [], { list: true, repo: "other" })).out).toBe("No archived plans.");
  });

  it("forgets a manual archive when cleared", async () => {
    await cli("archive", [STALE]);
    expect((await cli("archive", [STALE], { clear: true })).out).toBe(`Cleared the archive choice for ${STALE}.`);
    expect((await cli("archive", [], { list: true })).out).toBe("No archived plans.");
  });

  it("rejects unknown plans and refuses to write when read-only", async () => {
    expect((await cli("archive", ["acme/missing.md"])).code).toBe(1);
    config = { ...config, readOnly: true };
    const result = await cli("archive", [FRESH]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("read-only");
  });
});
