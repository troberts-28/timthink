import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../test/fixtures.js";
import { SEEN_FILE, SeenStore } from "./seenStore.js";

function clock(start: string) {
  let current = Date.parse(start);
  return () => {
    current += 1000;
    return new Date(current).toISOString();
  };
}

describe("SeenStore", () => {
  it("starts clean on first run by treating every current doc as seen", async () => {
    const stateDir = await makeTempDir();
    const store = new SeenStore({ stateDir, now: clock("2026-11-02T09:00:00Z") });
    expect(await store.init([{ path: "acme/a.md", hash: "h1" }])).toEqual({ created: true });
    expect(store.get("acme/a.md")).toMatchObject({ hash: "h1", previous: null });
    expect(store.initialisedAt).toBe("2026-11-02T09:00:01.000Z");
    const saved = JSON.parse(await readFile(path.join(stateDir, SEEN_FILE), "utf8"));
    expect(saved.docs["acme/a.md"].hash).toBe("h1");

    const reloaded = new SeenStore({ stateDir });
    expect(await reloaded.init([{ path: "acme/a.md", hash: "different" }])).toEqual({ created: false });
    expect(reloaded.get("acme/a.md")?.hash).toBe("h1");
  });

  it("marks docs seen and unseen, remembering the previous mark", async () => {
    const store = new SeenStore({ stateDir: await makeTempDir(), now: clock("2026-11-02T09:00:00Z") });
    await store.init([{ path: "acme/a.md", hash: "h1" }]);
    await store.markSeen("acme/a.md", "h2");
    expect(store.get("acme/a.md")).toMatchObject({ hash: "h2", previous: { hash: "h1" } });
    expect(store.keepHashes("acme/a.md")).toEqual(new Set(["h2", "h1"]));
    await store.markSeen("acme/a.md", "h2");
    expect(store.get("acme/a.md")?.previous?.hash).toBe("h1");
    await store.markThreadRead("acme/a.md", "t-1");
    expect(store.threadReadAt("acme/a.md", "t-1")).not.toBeNull();
    await store.markUnseen("acme/a.md");
    expect(store.get("acme/a.md")).toMatchObject({ hash: "h1", previous: null });
    expect(store.threadReadAt("acme/a.md", "t-1")).toBeNull();
    await store.markUnseen("acme/a.md");
    expect(store.get("acme/a.md")).toBeNull();
  });

  it("moves an unreadable seen.json aside and starts fresh", async () => {
    const stateDir = await makeTempDir();
    await writeFile(path.join(stateDir, SEEN_FILE), "{not json");
    const messages: string[] = [];
    const store = new SeenStore({ stateDir, log: (message) => messages.push(message) });
    expect(await store.init([])).toEqual({ created: true });
    expect(messages[0]).toMatch(/moved it to/);
  });
});
