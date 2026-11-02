import { describe, expect, it } from "vitest";
import { testConfig } from "../test/fixtures.js";
import { globToRegExp, isCheckoutOfRepo } from "./repoCheckouts.js";

const config = testConfig({
  codeRoot: "/code",
  repos: { platform: { host: "/code/platform", worktrees: "/code/platform-*" } },
});

describe("isCheckoutOfRepo", () => {
  it.each([
    ["/code/platform", true],
    ["/code/platform/packages/db", true],
    ["/code/platform-16", true],
    ["/code/platform-16/apps/web", true],
    ["/code/platform.bak", false],
    ["/code/other", false],
    ["relative/platform-2", false],
  ])("platform: %s -> %s", (cwd, expected) => {
    expect(isCheckoutOfRepo(config, "platform", cwd)).toBe(expected);
  });

  it("falls back to codeRoot/<repo> when there is no override", () => {
    expect(isCheckoutOfRepo(config, "acme-api", "/code/acme-api/src")).toBe(true);
    expect(isCheckoutOfRepo(config, "acme-api", "/code/acme-api-2")).toBe(false);
  });

  it("treats glob metacharacters other than * and ? literally", () => {
    expect(globToRegExp("/a/b.c-*").test("/a/b.c-1")).toBe(true);
    expect(globToRegExp("/a/b.c-*").test("/a/bxc-1")).toBe(false);
    expect(globToRegExp("/a/b-*").test("/a/b-1/c")).toBe(false);
  });
});
