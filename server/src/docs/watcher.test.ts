import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../test/fixtures.js";
import { watchDocsRoot } from "./watcher.js";

describe("watchDocsRoot", () => {
  it("reports changed paths relative to the root in a debounced batch", async () => {
    const root = await makeTempDir();
    const batches: string[][] = [];
    const watcher = watchDocsRoot(root, (paths) => batches.push(paths), { debounceMs: 50 });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(path.join(root, "a.md"), "# A");
      await writeFile(path.join(root, "b.md"), "# B");
      await expect.poll(() => batches.flat(), { timeout: 3000 }).toEqual(expect.arrayContaining(["a.md", "b.md"]));
    } finally {
      watcher.close();
    }
  });
});
