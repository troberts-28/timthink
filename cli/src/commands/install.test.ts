import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addTimthinkHooks, removeTimthinkHooks, shellQuote, timthinkHookState } from "./claudeHooks.js";
import {
  applySteps,
  type CommandResult,
  type CommandRunner,
  describeAction,
  describeSteps,
  hookScriptPath,
  type InstallAction,
  type InstallPaths,
  type InstallStep,
  installPaths,
  launcherPath,
  nodePathRecord,
  planInstall,
  planUninstall,
  plistPath,
  shimPath,
  skillLinkPath,
} from "./install.js";
import { unifiedDiff } from "./unifiedDiff.js";

const LABEL = "dev.timthink.test";

async function tempPaths(): Promise<InstallPaths> {
  const base = await mkdtemp(path.join(tmpdir(), "timthink-install-"));
  const repoRoot = path.join(base, "repo");
  await mkdir(path.join(repoRoot, "web", "dist"), { recursive: true });
  await writeFile(path.join(repoRoot, "web", "dist", "index.html"), "<!doctype html>");
  await mkdir(path.join(repoRoot, "skill"), { recursive: true });
  const home = path.join(base, "home");
  return installPaths({
    home,
    repoRoot,
    configPath: path.join(home, ".config", "timthink", "config.json"),
    nodePath: "/usr/local/bin/node",
    uid: 501,
    label: LABEL,
  });
}

interface FakeLaunchctl {
  run: CommandRunner;
  calls: string[][];
  loaded: () => boolean;
}

function fakeLaunchctl(initiallyLoaded = false): FakeLaunchctl {
  let loaded = initiallyLoaded;
  const calls: string[][] = [];
  const result = (code: number): CommandResult => ({ code, stdout: "", stderr: code === 0 ? "" : "not found" });
  const run: CommandRunner = async (command, args) => {
    calls.push([command, ...args]);
    const [verb] = args;
    if (verb === "print") return result(loaded ? 0 : 113);
    if (verb === "bootstrap") loaded = true;
    if (verb === "bootout") loaded = false;
    return result(0);
  };
  return { run, calls, loaded: () => loaded };
}

const EXISTING_SETTINGS = `${JSON.stringify(
  {
    model: "opus",
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: "warp-notify start" }] }],
      PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit-bash" }] }],
    },
    permissions: { allow: ["Read"] },
  },
  null,
  2,
)}\n`;

const NODE = "/usr/local/bin/node";
const SCRIPT = "/opt/timthink/hooks/timthink-hook.mjs";

const kinds = (steps: readonly InstallStep[]): string[] => steps.map((step) => `${step.label}:${step.action.kind}`);

function actionFor(
  steps: readonly InstallStep[],
  label: string,
  kind: InstallAction["kind"],
): InstallAction | undefined {
  return steps.find((step) => step.label === label && step.action.kind === kind)?.action;
}

async function writeSettings(paths: InstallPaths, text: string): Promise<void> {
  await mkdir(path.dirname(paths.claudeSettingsPath), { recursive: true });
  await writeFile(paths.claudeSettingsPath, text);
}

const missing = async (target: string): Promise<boolean> => (await lstat(target).catch(() => null)) === null;

describe("install", () => {
  it("plans every component on a fresh machine", async () => {
    const paths = await tempPaths();
    const steps = await planInstall(paths, { run: fakeLaunchctl().run, pathEnv: paths.binDir });
    expect(kinds(steps)).toEqual([
      "config:write-file",
      "node path:write-file",
      "cli shim:write-file",
      "logs:mkdir",
      "launchd agent:write-file",
      "skill:symlink",
      "claude hooks:write-file",
      "launchd agent:launchd-load",
    ]);
    const plist = actionFor(steps, "launchd agent", "write-file");
    const plistText = plist?.kind === "write-file" ? plist.after : "";
    expect(plistText).toContain(`<string>${LABEL}</string>`);
    expect(plistText).toContain(`<string>${launcherPath(paths)}</string>`);
    expect(plistText).toContain(`<string>${path.join(paths.repoRoot, "cli", "dist", "main.js")}</string>`);
    expect(plistText).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
    expect(plistText).toContain("<key>ThrottleInterval</key>");
    expect(plistText).toContain(`<string>${path.join(paths.logsDir, "err.log")}</string>`);
    expect(describeSteps(steps)).toContain(`run launchctl bootstrap gui/501 ${plistPath(paths)}`);
  });

  it("blocks when the web build is missing, a foreign shim exists or the skill path is a real folder", async () => {
    const paths = await tempPaths();
    await rm(path.join(paths.repoRoot, "web", "dist"), { recursive: true });
    await mkdir(paths.binDir, { recursive: true });
    await writeFile(shimPath(paths), "#!/bin/sh\necho someone else's timthink\n");
    await mkdir(skillLinkPath(paths), { recursive: true });
    const launchctl = fakeLaunchctl();
    const steps = await planInstall(paths, { run: launchctl.run });
    expect(steps.filter((step) => step.action.kind === "blocked").map((step) => step.label)).toEqual([
      "web build",
      "cli shim",
      "skill",
    ]);
    expect(describeSteps(steps)).toMatch(/✗ web build\s+.*run `pnpm build` first/);
    await expect(applySteps(steps, launchctl.run)).rejects.toThrow(/Nothing was changed/);
    expect(await missing(paths.configPath)).toBe(true);
    expect(launchctl.loaded()).toBe(false);
  });

  it("applies, is idempotent, and uninstalls back to where it started", async () => {
    const paths = await tempPaths();
    await writeSettings(paths, EXISTING_SETTINGS);
    const launchctl = fakeLaunchctl();
    await applySteps(await planInstall(paths, { run: launchctl.run, seed: { docsRoot: "~/plans" } }), launchctl.run);

    expect(JSON.parse(await readFile(paths.configPath, "utf8"))).toEqual({ docsRoot: "~/plans", codeRoot: "~/code" });
    expect(await readFile(nodePathRecord(paths), "utf8")).toBe("/usr/local/bin/node\n");
    expect(await readFile(shimPath(paths), "utf8")).toContain(`exec '${launcherPath(paths)}'`);
    expect((await stat(shimPath(paths))).mode & 0o111).not.toBe(0);
    expect((await stat(paths.logsDir)).isDirectory()).toBe(true);
    expect(await readFile(plistPath(paths), "utf8")).toContain("<key>RunAtLoad</key>");
    expect(await readlink(skillLinkPath(paths))).toBe(path.join(paths.repoRoot, "skill"));
    const settings = await readFile(paths.claudeSettingsPath, "utf8");
    expect(timthinkHookState(settings, launcherPath(paths), hookScriptPath(paths))).toBe("installed");
    expect(launchctl.loaded()).toBe(true);
    const backups = (await readdir(path.dirname(paths.claudeSettingsPath))).filter((name) =>
      name.startsWith("settings.json.timthink-backup-"),
    );
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(path.dirname(paths.claudeSettingsPath), backups[0] ?? ""), "utf8")).toBe(
      EXISTING_SETTINGS,
    );

    launchctl.calls.length = 0;
    const again = await planInstall(paths, { run: launchctl.run, pathEnv: paths.binDir });
    expect(kinds(again).filter((kind) => !kind.endsWith(":ok"))).toEqual(["launchd agent:launchd-load"]);
    await applySteps(again, launchctl.run);
    expect(launchctl.calls.map(([, verb]) => verb)).toEqual(["print", "bootout", "print", "bootstrap"]);

    await applySteps(await planUninstall(paths, { run: launchctl.run }), launchctl.run);
    expect(launchctl.loaded()).toBe(false);
    for (const gone of [plistPath(paths), shimPath(paths), skillLinkPath(paths), nodePathRecord(paths)]) {
      expect(await missing(gone)).toBe(true);
    }
    expect(await readFile(paths.claudeSettingsPath, "utf8")).toBe(EXISTING_SETTINGS);
    expect(await missing(paths.configPath)).toBe(false);
  });

  it("never overwrites an existing config and only suggests what the flags would add", async () => {
    const paths = await tempPaths();
    await mkdir(path.dirname(paths.configPath), { recursive: true });
    await writeFile(paths.configPath, '{ "docsRoot": "~/notes" }\n');
    const steps = await planInstall(paths, {
      run: fakeLaunchctl().run,
      seed: { docsRoot: "~/plans", codeRoot: "~/src" },
    });
    const configSteps = steps.filter((step) => step.label === "config").map((step) => step.action);
    expect(configSteps.map((action) => action.kind)).toEqual(["ok", "suggest"]);
    const suggestion = configSteps[1] ? describeAction(configSteps[1]) : "";
    expect(suggestion).toContain('+  "docsRoot": "~/plans",');
    expect(suggestion).toContain('+  "codeRoot": "~/src"');
    await applySteps(steps, fakeLaunchctl().run);
    expect(await readFile(paths.configPath, "utf8")).toBe('{ "docsRoot": "~/notes" }\n');
  });

  it("leaves files it didn't write alone on uninstall", async () => {
    const paths = await tempPaths();
    await mkdir(paths.binDir, { recursive: true });
    await writeFile(shimPath(paths), "#!/bin/sh\necho mine\n");
    const steps = await planUninstall(paths, { run: fakeLaunchctl().run });
    expect(actionFor(steps, "cli shim", "suggest")).toBeDefined();
    await applySteps(steps, fakeLaunchctl().run);
    expect(await readFile(shimPath(paths), "utf8")).toBe("#!/bin/sh\necho mine\n");
  });

  it("refuses to write settings that changed after the plan was shown", async () => {
    const paths = await tempPaths();
    await writeSettings(paths, EXISTING_SETTINGS);
    const launchctl = fakeLaunchctl();
    const steps = await planInstall(paths, { run: launchctl.run });
    await writeFile(paths.claudeSettingsPath, "{}\n");
    await expect(applySteps(steps, launchctl.run)).rejects.toThrow(/changed since the plan/);
    expect(await readFile(paths.claudeSettingsPath, "utf8")).toBe("{}\n");
  });

  it("shows the settings change as a unified diff with a timestamped backup", async () => {
    const paths = await tempPaths();
    await writeSettings(paths, EXISTING_SETTINGS);
    const steps = await planInstall(paths, { run: fakeLaunchctl().run, now: new Date("2026-11-02T10:00:00Z") });
    const action = actionFor(steps, "claude hooks", "write-file");
    expect(action?.kind === "write-file" && action.backup).toBe(
      `${paths.claudeSettingsPath}.timthink-backup-2026-11-02T10-00-00-000Z`,
    );
    const description = action ? describeAction(action) : "";
    expect(description).toContain(`--- ${paths.claudeSettingsPath}`);
    expect(description).toMatch(/^ {2}\+.*timthink-node.*timthink-hook\.mjs session-end \|\| true/m);
    const removed = description.split("\n").filter((line) => /^ {2}-(?!--)/.test(line));
    expect(removed.every((line) => /^ {2}-\s*[}\]],?$/.test(line))).toBe(true);
  });
});

describe("Claude hook settings", () => {
  const parse = (text: string | null): Record<string, unknown> => JSON.parse(text ?? "{}");

  it("adds one group per event and keeps existing hooks and keys in order", () => {
    const merged = parse(addTimthinkHooks(EXISTING_SETTINGS, NODE, SCRIPT));
    expect(Object.keys(merged)).toEqual(["model", "hooks", "permissions"]);
    expect(merged.hooks).toEqual({
      SessionStart: [
        { hooks: [{ type: "command", command: "warp-notify start" }] },
        { hooks: [{ type: "command", command: `${NODE} ${SCRIPT} session-start || true`, timeout: 5 }] },
      ],
      PostToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "audit-bash" }] },
        {
          matcher: "Write|Edit|MultiEdit",
          hooks: [{ type: "command", command: `${NODE} ${SCRIPT} post-tool-use || true`, timeout: 5 }],
        },
      ],
      SessionEnd: [{ hooks: [{ type: "command", command: `${NODE} ${SCRIPT} session-end || true`, timeout: 5 }] }],
    });
  });

  it("is idempotent and replaces entries that point at an old checkout", () => {
    const once = addTimthinkHooks(EXISTING_SETTINGS, NODE, SCRIPT);
    expect(addTimthinkHooks(once, NODE, SCRIPT)).toBe(once);
    const moved = addTimthinkHooks(once, NODE, "/new/place/hooks/timthink-hook.mjs");
    expect(moved.match(/timthink-hook\.mjs session-start/g)).toHaveLength(1);
    expect(moved).toContain("/new/place/hooks/timthink-hook.mjs session-start");
  });

  it("creates settings from nothing and removes them again cleanly", () => {
    const created = addTimthinkHooks(null, NODE, SCRIPT);
    expect(parse(created)).toHaveProperty("hooks.SessionEnd");
    expect(removeTimthinkHooks(created)).toBe("{}\n");
    expect(removeTimthinkHooks(null)).toBeNull();
    expect(removeTimthinkHooks(EXISTING_SETTINGS)).toBe(EXISTING_SETTINGS);
  });

  it("keeps a user's hook that shares a group with timthink's", () => {
    const shared = JSON.stringify({
      hooks: {
        SessionEnd: [
          {
            hooks: [
              { type: "command", command: "mine" },
              { type: "command", command: `${NODE} ${SCRIPT} session-end` },
            ],
          },
        ],
      },
    });
    expect(parse(removeTimthinkHooks(shared))).toEqual({
      hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "mine" }] }] },
    });
  });

  it("rejects settings it can't safely merge", () => {
    expect(() => addTimthinkHooks("{ not json", NODE, SCRIPT)).toThrow(/not valid JSON/);
    expect(() => addTimthinkHooks('{"hooks": []}', NODE, SCRIPT)).toThrow(/must be an object/);
  });

  it("reports whether this checkout's hooks are installed", () => {
    expect(timthinkHookState(EXISTING_SETTINGS, NODE, SCRIPT)).toBe("missing");
    const installed = addTimthinkHooks(EXISTING_SETTINGS, NODE, SCRIPT);
    expect(timthinkHookState(installed, NODE, SCRIPT)).toBe("installed");
    expect(timthinkHookState(installed, "/elsewhere/bin/timthink-node", SCRIPT)).toBe("outdated");
  });

  it("quotes paths with spaces or quotes for the shell", () => {
    expect(shellQuote("/Users/me/My Code/hook.mjs")).toBe("'/Users/me/My Code/hook.mjs'");
    expect(shellQuote("/a/it's.mjs")).toBe("'/a/it'\\''s.mjs'");
    expect(shellQuote("/usr/bin/node")).toBe("/usr/bin/node");
  });
});

describe("unifiedDiff", () => {
  it("prints hunks with context and line numbers", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n");
    const after = ["a", "b", "c", "d", "E", "f", "g", "h", "i", "j", "k"].join("\n");
    expect(unifiedDiff(`${before}\n`, `${after}\n`, "old", "new")).toBe(
      [
        "--- old",
        "+++ new",
        "@@ -2,9 +2,10 @@",
        " b",
        " c",
        " d",
        "-e",
        "+E",
        " f",
        " g",
        " h",
        " i",
        " j",
        "+k",
        "",
      ].join("\n"),
    );
    expect(unifiedDiff("same\n", "same\n", "a", "b")).toBe("");
  });

  it("diffs a new file against nothing", () => {
    expect(unifiedDiff("", "x\ny\n", "a", "b")).toBe("--- a\n+++ b\n@@ -0,0 +1,2 @@\n+x\n+y\n");
  });
});
