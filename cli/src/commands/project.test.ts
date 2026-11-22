import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "@timthink/server";
import { describe, expect, it } from "vitest";
import { runCheck } from "./check.js";
import { runProject } from "./project.js";

async function setup() {
  const docsRoot = await mkdtemp(path.join(tmpdir(), "timthink-project-"));
  const config = { ...loadConfig({ TIMTHINK_CONFIG: "/nonexistent.json" }), docsRoot, readOnly: false };
  const output: string[] = [];
  const io = { out: (text: string) => output.push(text), err: (text: string) => output.push(`ERR ${text}`) };
  const run = (args: string[], flags = {}) => runProject({ config, args, flags, io });
  return { docsRoot, output, run };
}

describe("timthink project", () => {
  it("creates a project in a new area, links a PR and shows it for an agent", async () => {
    const { docsRoot, output, run } = await setup();
    expect(await run(["create", "payments/checkout"], { title: "Checkout", repos: "acme-api,web" })).toBe(0);
    await writeFile(
      path.join(docsRoot, "payments/checkout/2026-11-22-checkout-research.md"),
      "---\ntitle: Checkout research\npr: 7\n---\n# Checkout research\n",
    );
    expect(await run(["link-pr", "payments/checkout", "web#12"])).toBe(0);
    expect(await run(["status", "payments/checkout", "Paused"])).toBe(0);
    output.length = 0;
    expect(await run(["show", "payments/checkout"])).toBe(0);
    const shown = output.join("\n");
    expect(shown).toContain("Status: paused · Area: payments · Repos: acme-api, web");
    expect(shown).toContain("research");
    expect(shown).toContain("PRs: web#12, acme-api#7");
    expect(await readFile(path.join(docsRoot, "payments/area.yaml"), "utf8")).toContain("payments");
  });

  it("lists projects by repo and refuses unknown ids and statuses", async () => {
    const { output, run } = await setup();
    await run(["create", "solo"], { title: "Solo", repos: "acme-api" });
    output.length = 0;
    expect(await run(["list"], { repo: "web" })).toBe(0);
    expect(await run(["list"], { repo: "acme-api" })).toBe(0);
    expect(output).toEqual(["No projects touch web.", "solo  active  Solo  [acme-api]"]);
    expect(await run(["show", "missing"])).toBe(1);
    expect(await run(["status", "solo", "someday"])).toBe(1);
    expect(await run(["create", "solo"], { title: "Again" })).toBe(1);
  });

  it("fails timthink check on a doc whose project.yaml has problems", async () => {
    const { docsRoot, output, run } = await setup();
    await run(["create", "solo"], { title: "Solo" });
    const doc = path.join(docsRoot, "solo", "plan.md");
    await writeFile(doc, "---\ntitle: Plan\n---\n# Plan\n");
    const config = { docsRoot };
    const io = { out: (text: string) => output.push(text), err: (text: string) => output.push(`ERR ${text}`) };
    expect(await runCheck(config, doc, io, async () => null)).toBe(0);
    await writeFile(path.join(docsRoot, "solo", "project.yaml"), "status: someday\n");
    expect(await runCheck(config, doc, io, async () => null)).toBe(1);
  });
});
