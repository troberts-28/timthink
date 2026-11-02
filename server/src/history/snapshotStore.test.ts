import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { docHash } from "../reviews/paths.js";
import { makeTempDir } from "../test/fixtures.js";
import { historyDirFor, parseSnapshotName, SnapshotStore, shortHash, snapshotId } from "./snapshotStore.js";

const DOC = "acme/plans/2026-11-02-feed.md";

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 10, 2, 9, minute));
}

describe("SnapshotStore", () => {
  it("names snapshots by time and short hash under the encoded doc path", () => {
    expect(historyDirFor(DOC)).toBe("acme/.timthink/history/plans%2F2026-11-02-feed.md");
    const id = snapshotId(at(5), docHash("hello"));
    expect(id).toBe(`2026-11-02T09-05-00-000Z-${shortHash(docHash("hello"))}`);
    expect(parseSnapshotName(`${id}.md`)).toEqual({
      id,
      at: "2026-11-02T09:05:00.000Z",
      shortHash: shortHash(docHash("hello")),
    });
    expect(parseSnapshotName("notes.md")).toBeNull();
  });

  it("skips a snapshot whose content matches the latest one", async () => {
    const store = new SnapshotStore(await makeTempDir());
    expect(await store.save(DOC, "one", { at: at(1) })).not.toBeNull();
    expect(await store.save(DOC, "one", { at: at(2) })).toBeNull();
    expect(await store.save(DOC, "two", { at: at(3) })).not.toBeNull();
    expect(await store.save(DOC, "one", { at: at(4) })).not.toBeNull();
    expect((await store.list(DOC)).map((entry) => entry.at)).toEqual([at(1), at(3), at(4)].map((d) => d.toISOString()));
  });

  it("keeps snapshot times increasing even when the file's mtime goes backwards", async () => {
    const store = new SnapshotStore(await makeTempDir());
    await store.save(DOC, "one", { at: at(10) });
    const second = await store.save(DOC, "two", { at: at(1) });
    expect(second?.at).toBe("2026-11-02T09:10:00.001Z");
  });

  it("caps history per doc but keeps the snapshots that seen entries point at", async () => {
    const root = await makeTempDir();
    const store = new SnapshotStore(root, 3);
    const keep = new Set([docHash("v0")]);
    for (let version = 0; version < 6; version += 1) {
      await store.save(DOC, `v${version}`, { at: at(version), keepHashes: keep });
    }
    const remaining = (await store.list(DOC)).map((entry) => entry.shortHash);
    expect(remaining).toEqual(["v0", "v3", "v4", "v5"].map((raw) => shortHash(docHash(raw))));
    const files = await readdir(path.join(root, historyDirFor(DOC) ?? ""));
    expect(files).toHaveLength(4);
  });

  it("reads snapshots back and records hub writes in a sidecar", async () => {
    const store = new SnapshotStore(await makeTempDir());
    const entry = await store.save(DOC, "accepted text", { at: at(1), humanWrite: { by: "human", name: "Sam" } });
    expect(entry).not.toBeNull();
    expect(await store.read(DOC, entry?.id ?? "")).toBe("accepted text");
    expect(await store.humanWrite(DOC, entry?.id ?? "")).toEqual({ by: "human", name: "Sam" });
    expect(await store.read(DOC, "../../etc/passwd")).toBeNull();
  });
});
