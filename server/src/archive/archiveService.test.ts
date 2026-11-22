import { beforeEach, describe, expect, it } from "vitest";
import { DocsStore } from "../docs/store.js";
import type { DocSummary } from "../docs/types.js";
import { copyFixtureDocs } from "../test/fixtures.js";
import { ArchiveService } from "./archiveService.js";
import { ArchiveStore } from "./archiveStore.js";

const PLAN = "acme-api/2026-09-15-auth-refresh-notes.md";

describe("ArchiveService", () => {
  let root: string;
  let docs: DocsStore;
  let service: ArchiveService;
  let projectStatus: string | null;

  const summary = (docPath: string): DocSummary => {
    const found = docs.getDoc(docPath);
    if (!found) throw new Error(`missing ${docPath}`);
    return found;
  };

  beforeEach(async () => {
    root = await copyFixtureDocs();
    docs = new DocsStore(root);
    await docs.scanAll();
    projectStatus = "active";
    service = new ArchiveService({
      docs,
      archives: new ArchiveStore(root),
      projectStatusOf: () => projectStatus,
    });
    await service.init();
  });

  it("archives a doc when its project ships, and lets manual choices override that", async () => {
    expect(service.stateFor(summary(PLAN)).state).toBe("active");
    projectStatus = "shipped";
    expect(service.stateFor(summary(PLAN))).toEqual({ state: "auto", reason: "Project shipped" });
    await service.apply(PLAN, "keep-active");
    expect(service.stateFor(summary(PLAN)).state).toBe("active");
    await service.apply(PLAN, "archive");
    expect(service.stateFor(summary(PLAN)).state).toBe("manual");
    await service.apply(PLAN, "clear");
    expect(service.stateFor(summary(PLAN)).state).toBe("auto");
  });

  it("picks up archive files written by another process", async () => {
    await new ArchiveStore(root).apply(PLAN, "archive", new Date().toISOString());
    expect(service.stateFor(summary(PLAN)).state).toBe("active");
    expect(await service.reloadRepo("acme-api")).toBe(true);
    expect(service.stateFor(summary(PLAN)).state).toBe("manual");
    expect(await service.reloadRepo("acme-api")).toBe(false);
  });
});
