import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { makeTempDir, testConfig } from "../test/fixtures.js";
import { createGitRepo, git } from "../test/gitRepo.js";
import { parseCodeRef } from "./codeRef.js";
import { CodeService } from "./codeService.js";
import { parseGithubRemote } from "./git.js";

describe("parseCodeRef", () => {
  it.each([
    ["src/a.ts", { path: "src/a.ts", line: null, col: null }],
    ["src/a.ts:42", { path: "src/a.ts", line: 42, col: null }],
    ["./src/a.ts:42:7", { path: "src/a.ts", line: 42, col: 7 }],
    ["/abs.ts", { path: "abs.ts", line: null, col: null }],
  ])("parses %s", (input, expected) => {
    expect(parseCodeRef(input)).toEqual(expected);
  });
});

describe("parseGithubRemote", () => {
  it.each([
    ["git@github.com:acme/api.git", { owner: "acme", repo: "api" }],
    ["ssh://git@github.com/acme/api.git", { owner: "acme", repo: "api" }],
    ["https://github.com/acme/api", { owner: "acme", repo: "api" }],
    ["https://token@github.com/acme/api.git\n", { owner: "acme", repo: "api" }],
    ["https://gitlab.com/acme/api.git", null],
  ])("parses %s", (url, expected) => {
    expect(parseGithubRemote(url)).toEqual(expected);
  });
});

describe("CodeService", () => {
  let codeRoot: string;
  let checkout: string;
  let service: CodeService;

  beforeAll(async () => {
    ({ codeRoot, checkout } = await createGitRepo());
    service = new CodeService(testConfig({ codeRoot }));
  });

  it("resolves an exact repo-relative path with a line and a GitHub link", async () => {
    const result = await service.resolve({ repo: "acme-api", ref: "src/middleware/rateLimit.ts:42" });
    expect(result).toMatchObject({
      status: "resolved",
      matches: [
        {
          relPath: "src/middleware/rateLimit.ts",
          line: 42,
          githubUrl: "https://github.com/acme/acme-api/blob/HEAD/src/middleware/rateLimit.ts#L42",
        },
      ],
    });
  });

  it("finds a bare filename through git ls-files", async () => {
    const result = await service.resolve({ repo: "acme-api", ref: "refresh.ts" });
    expect(result.status === "resolved" && result.matches.map((match) => match.relPath)).toEqual([
      "src/auth/refresh.ts",
    ]);
  });

  it("returns every candidate when a filename is ambiguous", async () => {
    const result = await service.resolve({ repo: "acme-api", ref: "tokens.ts:3" });
    expect(result.status === "resolved" && result.matches.map((match) => match.relPath).sort()).toEqual([
      "lib/tokens.ts",
      "src/auth/tokens.ts",
    ]);
  });

  it("matches a path suffix", async () => {
    const result = await service.resolve({ repo: "acme-api", ref: "load/burst.js:12:3" });
    expect(result).toMatchObject({
      status: "resolved",
      matches: [{ relPath: "scripts/load/burst.js", line: 12, col: 3 }],
    });
  });

  it("reports unknown files and repos without a checkout", async () => {
    expect(await service.resolve({ repo: "acme-api", ref: "nope.ts" })).toMatchObject({ status: "not-found" });
    expect(await service.resolve({ repo: "missing-repo", ref: "a.ts" })).toEqual({ status: "no-checkout" });
  });

  it("does not resolve paths that escape the checkout", async () => {
    await writeFile(path.join(codeRoot, "outside.ts"), "");
    expect(await service.resolve({ repo: "acme-api", ref: "../outside.ts" })).toMatchObject({ status: "not-found" });
  });

  it("refreshes the file index when HEAD moves", async () => {
    expect(await service.resolve({ repo: "acme-api", ref: "fresh.ts" })).toMatchObject({ status: "not-found" });
    await mkdir(path.join(checkout, "src", "new"), { recursive: true });
    await writeFile(path.join(checkout, "src", "new", "fresh.ts"), "");
    git(checkout, "add", ".");
    git(checkout, "commit", "-q", "-m", "add fresh");
    expect(await service.resolve({ repo: "acme-api", ref: "fresh.ts" })).toMatchObject({
      status: "resolved",
      matches: [{ relPath: "src/new/fresh.ts" }],
    });
  });

  it("prefers a session worktree whose current branch is the plan's branch", async () => {
    const worktree = path.join(codeRoot, "acme-api-2");
    git(checkout, "worktree", "add", "-q", "-b", "feat/x", worktree);
    await mkdir(path.join(worktree, "src", "auth", "deep"), { recursive: true });
    const resolution = await service.resolve({
      repo: "acme-api",
      ref: "refresh.ts",
      docBranch: "feat/x",
      session: { worktree: path.join(worktree, "src", "auth", "deep") },
    });
    expect(resolution).toMatchObject({ status: "resolved", checkout: await realpath(worktree) });
  });

  it("falls back to the host when the session worktree has moved to another branch", async () => {
    const worktree = path.join(codeRoot, "acme-api-3");
    git(checkout, "worktree", "add", "-q", "-b", "feat/y", worktree);
    const moved = new CodeService(testConfig({ codeRoot }));
    const before = await moved.resolveCheckout({ repo: "acme-api", docBranch: "feat/y", session: { worktree } });
    expect(before).toBe(await realpath(worktree));
    git(worktree, "checkout", "-q", "-b", "something-else");
    const fresh = new CodeService(testConfig({ codeRoot }));
    expect(await fresh.resolveCheckout({ repo: "acme-api", docBranch: "feat/y", session: { worktree } })).toBe(
      checkout,
    );
    expect(await fresh.resolveCheckout({ repo: "acme-api", docBranch: null, session: { worktree } })).toBe(checkout);
  });

  it("only allows opening real paths inside the code roots", async () => {
    const outside = await makeTempDir();
    await writeFile(path.join(outside, "secret.ts"), "");
    await symlink(path.join(outside, "secret.ts"), path.join(checkout, "link.ts"));
    expect(await service.isOpenable(path.join(checkout, "src", "auth", "refresh.ts"))).toBe(true);
    expect(await service.isOpenable(path.join(checkout, "link.ts"))).toBe(false);
    expect(await service.isOpenable(path.join(outside, "secret.ts"))).toBe(false);
  });
});
