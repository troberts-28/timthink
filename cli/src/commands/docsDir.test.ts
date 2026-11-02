import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findDocsDir, resolveDocsFolder } from "./docsDir.js";

const FOLDERS = ["platform", "storefront", "date-picker-kit", "react", "timthink"];

describe("resolveDocsFolder", () => {
  it("uses an existing folder with the repo's exact name", () => {
    expect(resolveDocsFolder("date-picker-kit", FOLDERS, {})).toEqual({
      folder: "date-picker-kit",
      match: "exact",
    });
  });

  it("strips worktree suffixes down to the longest existing folder", () => {
    expect(resolveDocsFolder("platform-16", FOLDERS, {})).toEqual({ folder: "platform", match: "worktree-prefix" });
    expect(resolveDocsFolder("storefront-backend-phase-3", FOLDERS, {})).toEqual({
      folder: "storefront",
      match: "worktree-prefix",
    });
    expect(resolveDocsFolder("date-picker-kit-2", FOLDERS, {})).toEqual({
      folder: "date-picker-kit",
      match: "worktree-prefix",
    });
  });

  it("honours configured aliases", () => {
    expect(resolveDocsFolder("mono-checkout", FOLDERS, { platform: ["mono-checkout"] })).toEqual({
      folder: "platform",
      match: "alias",
    });
  });

  it("falls back to the repo name when nothing matches", () => {
    expect(resolveDocsFolder("brand-new", FOLDERS, {})).toEqual({ folder: "brand-new", match: "none" });
    expect(resolveDocsFolder("platformer", FOLDERS, {})).toEqual({ folder: "platformer", match: "none" });
  });
});

describe("findDocsDir", () => {
  it("resolves from a directory's git toplevel, or its own name outside git", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "timthink-docsdir-"));
    const docsRoot = path.join(base, "docs");
    await mkdir(path.join(docsRoot, "platform"), { recursive: true });
    const worktree = path.join(base, "code", "platform-16");
    await mkdir(worktree, { recursive: true });
    const found = await findDocsDir({ docsRoot, repos: {} }, worktree);
    expect(found).toEqual({
      dir: path.join(docsRoot, "platform"),
      exists: true,
      repoName: "platform-16",
      match: "worktree-prefix",
    });
    const missing = await findDocsDir({ docsRoot, repos: {} }, path.join(base, "code"));
    expect(missing).toMatchObject({ dir: path.join(docsRoot, "code"), exists: false });
  });
});
