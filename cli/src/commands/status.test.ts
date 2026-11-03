import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "@timthink/server";
import { describe, expect, it } from "vitest";
import { runStatus } from "./status.js";

async function setup(readOnly = false) {
  const docsRoot = await mkdtemp(path.join(tmpdir(), "timthink-status-"));
  await mkdir(path.join(docsRoot, "acme"));
  const file = path.join(docsRoot, "acme", "plan.md");
  await writeFile(file, "---\ntitle: Plan\nstatus: draft\n---\n# Plan\n");
  const config = { ...loadConfig({ TIMTHINK_CONFIG: "/nonexistent.json" }), docsRoot, readOnly };
  const output: string[] = [];
  const io = { out: (text: string) => output.push(text), err: (text: string) => output.push(`ERR ${text}`) };
  return { config, file, output, io };
}

describe("runStatus", () => {
  it("prints the status, and sets a canonical one from a synonym", async () => {
    const { config, file, output, io } = await setup();
    expect(await runStatus(config, ["acme/plan.md"], io)).toBe(0);
    expect(await runStatus(config, ["acme/plan.md", "WIP"], io)).toBe(0);
    expect(output).toEqual(["draft", "acme/plan.md: in-progress"]);
    expect(await readFile(file, "utf8")).toContain("status: in-progress\n");
  });

  it("refuses approved, unknown values and read-only hubs", async () => {
    const { config, file, output, io } = await setup();
    expect(await runStatus(config, ["acme/plan.md", "approved"], io)).toBe(1);
    expect(await runStatus(config, ["acme/plan.md", "someday"], io)).toBe(1);
    const readOnly = await setup(true);
    expect(await runStatus(readOnly.config, ["acme/plan.md", "done"], readOnly.io)).toBe(1);
    expect(output.every((line) => line.startsWith("ERR"))).toBe(true);
    expect(await readFile(file, "utf8")).toContain("status: draft\n");
  });
});
