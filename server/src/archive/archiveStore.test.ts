import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ReadOnlyError } from "../readOnly.js";
import { InvalidDocPathError } from "../reviews/reviewStore.js";
import { makeTempDir } from "../test/fixtures.js";
import { ArchiveStore, CorruptArchiveFileError, manualFor } from "./archiveStore.js";

const AT = "2026-11-03T10:00:00.000Z";

describe("ArchiveStore", () => {
  let root: string;
  let store: ArchiveStore;

  beforeEach(async () => {
    root = await makeTempDir();
    store = new ArchiveStore(root);
  });

  it("reads an empty archive when none exists", async () => {
    expect(await store.read("app")).toEqual({ schemaVersion: 1, version: 0, archived: {}, keepActive: {} });
  });

  it("records archive, keep-active and clear per repo-relative path", async () => {
    await store.apply("app/plans/a.md", "archive", AT);
    let file = await store.read("app");
    expect(manualFor(file, "plans/a.md")).toEqual({ kind: "archived", at: AT });

    await store.apply("app/plans/a.md", "keep-active", AT);
    file = await store.read("app");
    expect(file.archived).toEqual({});
    expect(manualFor(file, "plans/a.md")).toEqual({ kind: "keep-active", at: AT });

    await store.apply("app/plans/a.md", "clear", AT);
    file = await store.read("app");
    expect(manualFor(file, "plans/a.md")).toBeNull();
    expect(file.version).toBe(3);
    const onDisk = JSON.parse(await readFile(path.join(root, "app/.timthink/archive.json"), "utf8"));
    expect(onDisk.version).toBe(3);
  });

  it("serialises concurrent writers without losing updates", async () => {
    const docs = Array.from({ length: 20 }, (_, position) => `app/plan-${position}.md`);
    const other = new ArchiveStore(root);
    await Promise.all(docs.map((docPath, position) => (position % 2 ? store : other).apply(docPath, "archive", AT)));
    const file = await store.read("app");
    expect(Object.keys(file.archived).sort()).toEqual(docs.map((docPath) => docPath.slice(4)).sort());
    expect(file.version).toBe(20);
  });

  it("refuses to write when read-only", async () => {
    await expect(new ArchiveStore(root, { readOnly: true }).apply("app/a.md", "archive", AT)).rejects.toBeInstanceOf(
      ReadOnlyError,
    );
  });

  it("rejects paths that escape the docs root", async () => {
    await expect(store.apply("../a.md", "archive", AT)).rejects.toBeInstanceOf(InvalidDocPathError);
    expect(() => store.filePath(".timthink")).toThrow(InvalidDocPathError);
  });

  it("reports a corrupt archive file", async () => {
    await mkdir(path.join(root, "app/.timthink"), { recursive: true });
    await writeFile(path.join(root, "app/.timthink/archive.json"), "{nope");
    await expect(store.read("app")).rejects.toBeInstanceOf(CorruptArchiveFileError);
  });
});
