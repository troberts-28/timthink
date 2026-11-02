import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, prLinkHostFor } from "./config.js";
import { makeTempDir } from "./test/fixtures.js";

describe("loadConfig", () => {
  it("reads session paths and per-repo PR hosts, with env overrides winning", async () => {
    const configPath = path.join(await makeTempDir(), "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        stateDir: "~/state",
        claudeProjectsDir: "/data/claude/projects",
        repos: { app: { prLinks: "github" }, platform: { worktrees: "~/code/platform-*" } },
      }),
    );
    const config = loadConfig({ TIMTHINK_CONFIG: configPath, TIMTHINK_WARP_TAB_CONFIG_DIR: "/tmp/tabs" });
    expect(config.stateDir).toBe(path.join(homedir(), "state"));
    expect(config.claudeProjectsDir).toBe("/data/claude/projects");
    expect(config.warpTabConfigDir).toBe("/tmp/tabs");
    expect(config.repos.platform?.worktrees).toBe(path.join(homedir(), "code", "platform-*"));
    expect(prLinkHostFor(config, "app")).toBe("github");
    expect(prLinkHostFor(config, "platform")).toBe("graphite");
    expect(loadConfig({ TIMTHINK_CONFIG: configPath, TIMTHINK_STATE_DIR: "/override" }).stateDir).toBe("/override");
  });

  it("rejects an unknown PR host", async () => {
    const configPath = path.join(await makeTempDir(), "config.json");
    await writeFile(configPath, JSON.stringify({ repos: { app: { prLinks: "gitlab" } } }));
    expect(() => loadConfig({ TIMTHINK_CONFIG: configPath })).toThrow(/Invalid config/);
  });
});
