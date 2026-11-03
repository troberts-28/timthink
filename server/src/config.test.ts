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

  it("reads groups, archive settings and the read-only flag", async () => {
    const configPath = path.join(await makeTempDir(), "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        groups: [
          { name: "Work", owners: ["acme-corp"] },
          { name: "Personal", default: true },
        ],
        archive: { staleAfterDays: 30 },
      }),
    );
    const config = loadConfig({ TIMTHINK_CONFIG: configPath });
    expect(config.groups).toEqual([
      { name: "Work", owners: ["acme-corp"], repos: [], default: false },
      { name: "Personal", owners: [], repos: [], default: true },
    ]);
    expect(config.archive).toEqual({
      auto: true,
      staleAfterDays: 30,
      inFlightStaleAfterDays: 60,
      finishedAfterDays: 3,
    });
    expect(config.readOnly).toBe(false);
    expect(loadConfig({ TIMTHINK_CONFIG: configPath, TIMTHINK_READONLY: "1" }).readOnly).toBe(true);
    expect(loadConfig({ TIMTHINK_CONFIG: path.join(path.dirname(configPath), "missing.json") }).groups).toBeNull();
  });

  it("rejects an unknown PR host", async () => {
    const configPath = path.join(await makeTempDir(), "config.json");
    await writeFile(configPath, JSON.stringify({ repos: { app: { prLinks: "gitlab" } } }));
    expect(() => loadConfig({ TIMTHINK_CONFIG: configPath })).toThrow(/Invalid config/);
  });
});
