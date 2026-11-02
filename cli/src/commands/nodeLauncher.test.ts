import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const LAUNCHER = fileURLToPath(new URL("../../../bin/timthink-node", import.meta.url));
const SYSTEM_NODES = ["/opt/homebrew/bin/node", "/usr/local/bin/node"];

interface LauncherRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

async function fakeNode(file: string, name: string): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `#!/bin/sh\necho ${name} "$@"\n`);
  await chmod(file, 0o755);
  return file;
}

describe("bin/timthink-node", () => {
  let base: string;
  let home: string;
  let nvmDir: string;
  let emptyPath: string;

  const run = (env: NodeJS.ProcessEnv, args: string[] = []): LauncherRun => {
    const result = spawnSync("/bin/sh", [LAUNCHER, ...args], { env, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  };
  const baseEnv = (): NodeJS.ProcessEnv => ({ HOME: home, NVM_DIR: nvmDir, PATH: emptyPath });
  const installVersions = async (...versions: string[]): Promise<void> => {
    for (const version of versions) {
      await fakeNode(path.join(nvmDir, "versions", "node", version, "bin", "node"), version);
    }
  };
  const setAlias = async (name: string, value: string): Promise<void> => {
    await mkdir(path.dirname(path.join(nvmDir, "alias", name)), { recursive: true });
    await writeFile(path.join(nvmDir, "alias", name), `${value}\n`);
  };

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "timthink-launcher-"));
    home = path.join(base, "home");
    nvmDir = path.join(base, "nvm");
    emptyPath = path.join(base, "empty-bin");
    await mkdir(emptyPath, { recursive: true });
    await mkdir(home, { recursive: true });
  });

  it("prefers $TIMTHINK_NODE and passes arguments through untouched", async () => {
    const explicit = await fakeNode(path.join(base, "explicit", "node"), "explicit");
    await installVersions("v22.13.1");
    expect(run({ ...baseEnv(), TIMTHINK_NODE: explicit }, ["a b", "--flag"])).toMatchObject({
      status: 0,
      stdout: "explicit a b --flag",
    });
  });

  it("uses the node recorded at install time while it still exists", async () => {
    const recorded = await fakeNode(path.join(base, "recorded", "node"), "recorded");
    await installVersions("v22.13.1");
    await mkdir(path.join(home, ".config", "timthink"), { recursive: true });
    await writeFile(path.join(home, ".config", "timthink", "node-path"), `${recorded}\n`);
    expect(run(baseEnv()).stdout).toBe("recorded");

    const configDir = path.join(base, "custom-config");
    await mkdir(configDir);
    await writeFile(path.join(configDir, "node-path"), path.join(base, "gone", "node"));
    expect(run({ ...baseEnv(), TIMTHINK_CONFIG: path.join(configDir, "config.json") }).stdout).toBe("v22.13.1");
  });

  it("falls back to node on PATH before nvm", async () => {
    await fakeNode(path.join(emptyPath, "node"), "path-node");
    await installVersions("v22.13.1");
    expect(run(baseEnv()).stdout).toBe("path-node");
  });

  it("resolves the nvm default alias to the highest matching installed version", async () => {
    await installVersions("v18.20.0", "v22.9.0", "v22.13.1", "v24.1.0");
    await setAlias("default", "22");
    expect(run(baseEnv()).stdout).toBe("v22.13.1");
    await setAlias("default", "v22.9.0");
    expect(run(baseEnv()).stdout).toBe("v22.9.0");
    await setAlias("default", "22.1");
    expect(run(baseEnv()).stdout).toBe("v24.1.0");
  });

  it("follows alias chains and falls back to the newest install for aliases it can't resolve", async () => {
    await installVersions("v20.11.0", "v22.13.1", "v24.1.0");
    await setAlias("lts/iron", "v20.11.0");
    await setAlias("default", "lts/iron");
    expect(run(baseEnv()).stdout).toBe("v20.11.0");
    for (const alias of ["lts/*", "node", "stable"]) {
      await setAlias("default", alias);
      expect(run(baseEnv()).stdout).toBe("v24.1.0");
    }
  });

  it("looks in ~/.nvm when NVM_DIR is unset", async () => {
    nvmDir = path.join(home, ".nvm");
    await installVersions("v22.13.1");
    await setAlias("default", "22");
    expect(run({ HOME: home, PATH: emptyPath }).stdout).toBe("v22.13.1");
  });

  it.skipIf(SYSTEM_NODES.some((node) => existsSync(node)))("exits 127 with a hint when there is no node", () => {
    const result = run(baseEnv());
    expect(result.status).toBe(127);
    expect(result.stderr).toMatch(/could not find node.*TIMTHINK_NODE/);
  });

  it("adds little overhead", async () => {
    await installVersions("v22.9.0", "v22.13.1", "v24.1.0");
    await setAlias("default", "22");
    const direct = path.join(nvmDir, "versions", "node", "v22.13.1", "bin", "node");
    const median = (samples: number[]): number => samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)] ?? 0;
    const time = (command: () => void): number => {
      const started = performance.now();
      command();
      return performance.now() - started;
    };
    const launcherMs = median(Array.from({ length: 9 }, () => time(() => run(baseEnv()))));
    const directMs = median(
      Array.from({ length: 9 }, () => time(() => spawnSync("/bin/sh", [direct], { env: baseEnv() }))),
    );
    expect(launcherMs - directMs).toBeLessThan(25);
  });
});
