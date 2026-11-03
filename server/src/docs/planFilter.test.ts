import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyFixtureDocs } from "../test/fixtures.js";
import { IGNORE_FILE, PlanFilter } from "./planFilter.js";
import { DocsStore } from "./store.js";

describe("PlanFilter", () => {
  it("never treats agent instruction files as plans", () => {
    const filter = PlanFilter.none();
    expect(filter.isPlan("acme-api/drafts/AGENTS.md")).toBe(false);
    expect(filter.isPlan("acme-api/drafts/server/claude.md")).toBe(false);
    expect(filter.isPlan("acme-api/2026-10-01-plan.md")).toBe(true);
  });

  it("applies .timthinkignore rules from the docs root and from each repo folder", async () => {
    const root = await copyFixtureDocs();
    await writeFile(path.join(root, IGNORE_FILE), "**/prompts/\n");
    await writeFile(path.join(root, "acme-api", IGNORE_FILE), "scratch-*.md\n/notes/\n");
    const filter = await PlanFilter.load(root);
    expect(filter.isPlan("garden-app/prompts/system.md")).toBe(false);
    expect(filter.isPlan("acme-api/scratch-ideas.md")).toBe(false);
    expect(filter.isPlan("acme-api/billing-migration/notes/a.md")).toBe(true);
    expect(filter.isPlan("acme-api/notes/a.md")).toBe(false);
    expect(filter.isPlan("garden-app/scratch-ideas.md")).toBe(true);
  });
});

describe("DocsStore with plan rules", () => {
  it("indexes filtered markdown as files and rescans when the rules change", async () => {
    const root = await copyFixtureDocs();
    await mkdir(path.join(root, "acme-api", "drafts"), { recursive: true });
    await writeFile(path.join(root, "acme-api", "drafts", "AGENTS.md"), "# Agents\n");
    await writeFile(path.join(root, "acme-api", "drafts", "prompt.md"), "# Prompt\n");
    const store = new DocsStore(root);
    await store.scanAll();
    expect(store.getDoc("acme-api/drafts/AGENTS.md")).toBeUndefined();
    expect(store.hasAttachment("acme-api/drafts/AGENTS.md")).toBe(true);
    expect(store.getDoc("acme-api/drafts/prompt.md")).toBeDefined();

    await writeFile(path.join(root, "acme-api", IGNORE_FILE), "drafts/\n");
    const result = await store.applyChanges([`acme-api/${IGNORE_FILE}`]);
    expect(result.removedDocs).toEqual(["acme-api/drafts/prompt.md"]);
    expect(store.getDoc("acme-api/drafts/prompt.md")).toBeUndefined();
  });
});
