import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { copyFixtureDocs } from "../test/fixtures.js";
import { DocsStore } from "./store.js";
import type { RepoIndex } from "./types.js";

const noGithub = () => ({ github: null, prLinks: "graphite" as const });

function repo(store: DocsStore, name: string): RepoIndex {
  const found = store.buildIndex(noGithub).repos.find((entry) => entry.name === name);
  if (!found) throw new Error(`repo ${name} missing`);
  return found;
}

describe("DocsStore", () => {
  let root: string;
  let store: DocsStore;

  beforeEach(async () => {
    root = await copyFixtureDocs();
    store = new DocsStore(root);
    await store.scanAll();
  });

  it("indexes repos, projects and ungrouped docs", () => {
    const index = store.buildIndex(noGithub);
    expect(index.repos.map((entry) => entry.name)).toEqual(["acme-api", "garden-app"]);

    const acme = repo(store, "acme-api");
    expect(acme.docCount).toBe(6);
    expect(acme.ungrouped.map((doc) => doc.relPath)).toEqual([
      "2026-10-01-rate-limiter-plan.md",
      "2026-09-15-auth-refresh-notes.md",
      "2026-08-02-broken-frontmatter.md",
      "untitled-scratch.md",
    ]);
    const billing = acme.projects.find((project) => project.name === "billing-migration");
    expect(billing?.docs.map((doc) => doc.relPath)).toEqual([
      "billing-migration/notes/2026-10-21-open-questions.md",
      "billing-migration/2026-10-20-billing-migration-plan.md",
    ]);
  });

  it("lists non-markdown files as attachments of their project or repo root", () => {
    const acme = repo(store, "acme-api");
    expect(acme.rootAttachmentCount).toBe(1);
    expect(acme.projects.find((project) => project.name === "billing-migration")?.attachmentCount).toBe(2);
    expect(store.attachmentsIn("acme-api", null).map((file) => file.relPath)).toEqual([
      "2026-10-01-rate-limiter-demo.html",
    ]);
    expect(store.attachmentsIn("acme-api", "billing-migration")).toEqual([
      expect.objectContaining({
        relPath: "billing-migration/data/sample-invoices.json",
        type: "application/json; charset=utf-8",
      }),
      expect.objectContaining({ relPath: "billing-migration/diagrams/flow.png", type: "image/png" }),
    ]);
  });

  it("skips dotfiles, .timthink and node_modules", () => {
    const paths = store.allDocs().map((doc) => doc.path);
    expect(paths.some((docPath) => docPath.includes("node_modules"))).toBe(false);
    const garden = repo(store, "garden-app");
    expect(garden.rootAttachmentCount).toBe(0);
    expect(garden.projects.map((project) => project.attachmentCount)).toEqual([0, 0, 0]);
  });

  it("applies frontmatter project overrides", () => {
    const garden = repo(store, "garden-app");
    expect(garden.projects.map((project) => project.name).sort()).toEqual(["brainstorms", "hardware", "plans"]);
  });

  it("parses task progress and tolerates malformed frontmatter", () => {
    expect(store.getDoc("acme-api/2026-10-01-rate-limiter-plan.md")?.tasks).toEqual({ done: 2, total: 4 });
    const broken = store.getDoc("acme-api/2026-08-02-broken-frontmatter.md");
    expect(broken?.title).toBe("A plan whose frontmatter is malformed");
    expect(broken?.frontmatterError).toBeTruthy();
  });

  it("matches root attachments to the doc sharing their date prefix", () => {
    const plan = store.getDoc("acme-api/2026-10-01-rate-limiter-plan.md");
    const notes = store.getDoc("acme-api/2026-09-15-auth-refresh-notes.md");
    if (!plan || !notes) throw new Error("fixtures missing");
    expect(store.attachmentsFor(plan).map((file) => file.relPath)).toEqual(["2026-10-01-rate-limiter-demo.html"]);
    expect(store.attachmentsFor(notes)).toEqual([]);
  });

  it("re-indexes changed, added and removed files incrementally", async () => {
    const planPath = "acme-api/2026-10-01-rate-limiter-plan.md";
    await writeFile(path.join(root, planPath), "---\ntitle: Renamed\n---\n- [x] a\n");
    await mkdir(path.join(root, "acme-api", "new-project"));
    await writeFile(path.join(root, "acme-api", "new-project", "idea.md"), "# Idea\n");
    await rm(path.join(root, "acme-api", "untitled-scratch.md"));

    const result = await store.applyChanges([
      planPath,
      "acme-api/new-project",
      "acme-api/untitled-scratch.md",
      "garden-app/node_modules/leftpad/README.md",
    ]);

    expect(result.changed).toBe(true);
    expect(result.changedDocs).toEqual(expect.arrayContaining([planPath, "acme-api/new-project/idea.md"]));
    expect(result.removedDocs).toEqual(["acme-api/untitled-scratch.md"]);
    expect(store.getDoc(planPath)?.title).toBe("Renamed");
    expect(store.getDoc("acme-api/new-project/idea.md")?.project).toBe("new-project");
  });

  it("drops everything under a removed folder", async () => {
    await rm(path.join(root, "acme-api", "billing-migration"), { recursive: true });
    const result = await store.applyChanges(["acme-api/billing-migration"]);
    expect(result.removedDocs).toHaveLength(2);
    expect(repo(store, "acme-api").projects).toEqual([]);
  });
});
