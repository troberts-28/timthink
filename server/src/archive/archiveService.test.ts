import { utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ARCHIVE_SETTINGS } from "../config.js";
import { DocsStore } from "../docs/store.js";
import type { DocSummary } from "../docs/types.js";
import { ReviewService } from "../reviews/reviewService.js";
import { copyFixtureDocs } from "../test/fixtures.js";
import { ArchiveService } from "./archiveService.js";
import { ArchiveStore } from "./archiveStore.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN = "acme-api/2026-09-15-auth-refresh-notes.md";

describe("ArchiveService", () => {
  let root: string;
  let docs: DocsStore;
  let reviews: ReviewService;
  let service: ArchiveService;
  const threadReads = new Map<string, string>();

  const summary = (docPath: string): DocSummary => {
    const found = docs.getDoc(docPath);
    if (!found) throw new Error(`missing ${docPath}`);
    return found;
  };

  const age = async (docPath: string, days: number): Promise<void> => {
    const when = new Date(Date.now() - days * DAY_MS);
    await utimes(path.join(root, docPath), when, when);
    await docs.applyChanges([docPath]);
  };

  beforeEach(async () => {
    root = await copyFixtureDocs();
    docs = new DocsStore(root);
    await docs.scanAll();
    reviews = new ReviewService({ docsRoot: root, userName: "Sam" });
    threadReads.clear();
    service = new ArchiveService({
      docs,
      reviews: reviews.store,
      archives: new ArchiveStore(root),
      marks: { docSeenAt: () => null, threadReadAt: (_doc, threadId) => threadReads.get(threadId) ?? null },
      settings: DEFAULT_ARCHIVE_SETTINGS,
    });
    await service.init();
  });

  it("auto-archives stale docs and revives them when the file is edited", async () => {
    await age(PLAN, 40);
    expect(service.stateFor(summary(PLAN))).toEqual({ state: "auto", reason: "Not edited for 40 days" });
    await writeFile(path.join(root, PLAN), "# Auth token refresh notes\n\nEdited.\n");
    await docs.applyChanges([PLAN]);
    expect(service.stateFor(summary(PLAN)).state).toBe("active");
  });

  it("applies manual archive and keep-active over the rule", async () => {
    await service.apply(PLAN, "archive");
    expect(service.stateFor(summary(PLAN)).state).toBe("manual");
    await age(PLAN, 40);
    await service.apply(PLAN, "keep-active");
    expect(service.stateFor(summary(PLAN)).state).toBe("active");
    await service.apply(PLAN, "clear");
    expect(service.stateFor(summary(PLAN)).state).toBe("auto");
  });

  it("keeps a stale doc active while its review needs the user", async () => {
    await age(PLAN, 40);
    const { hash, raw } = await reviews.readDoc(PLAN);
    const start = raw.indexOf("Refresh tokens");
    const created = await reviews.createThread(PLAN, {
      version: 0,
      docHash: hash,
      start,
      end: start + 4,
      kind: "comment",
      body: "Why?",
      suggestion: null,
    });
    expect(await service.refreshDoc(PLAN)).toBe(true);
    expect(service.stateFor(summary(PLAN)).state).toBe("active");

    const submitted = await reviews.submit(PLAN, created.version, "comment", "");
    const threadId = submitted.review.threads[0]?.id ?? "";
    await reviews.reply(PLAN, null, threadId, "Because.", { author: "claude", name: "Claude" });
    await reviews.markAddressed(PLAN);
    await age(PLAN, 40);
    expect(await service.refreshDoc(PLAN)).toBe(false);
    expect(service.stateFor(summary(PLAN)).state).toBe("active");

    threadReads.set(threadId, new Date().toISOString());
    expect(await service.refreshDoc(PLAN)).toBe(true);
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
