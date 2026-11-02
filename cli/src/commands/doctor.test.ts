import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, type TimthinkConfig } from "@timthink/server";
import { describe, expect, it } from "vitest";
import { type DoctorDeps, doctorChecks, formatChecks, type PortStatus } from "./doctor.js";
import { applySteps, type CommandRunner, type InstallPaths, installPaths, planInstall } from "./install.js";

interface Machine {
  paths: InstallPaths;
  config: () => TimthinkConfig;
  deps: (port: PortStatus) => DoctorDeps;
  launchctl: CommandRunner;
}

async function machine(nodeVersion = "v22.13.1"): Promise<Machine> {
  const base = await mkdtemp(path.join(tmpdir(), "timthink-doctor-"));
  const home = path.join(base, "home");
  const repoRoot = path.join(base, "repo");
  await mkdir(path.join(repoRoot, "web", "dist"), { recursive: true });
  await writeFile(path.join(repoRoot, "web", "dist", "index.html"), "<!doctype html>");
  await mkdir(path.join(repoRoot, "skill"), { recursive: true });
  await mkdir(path.join(home, "agent-docs", "acme-api"), { recursive: true });
  const zedDir = path.join(base, "zed-bin");
  await mkdir(zedDir);
  await writeFile(path.join(zedDir, "zed"), "#!/bin/sh\n");
  await chmod(path.join(zedDir, "zed"), 0o755);
  const configPath = path.join(home, ".config", "timthink", "config.json");
  const paths = installPaths({
    home,
    repoRoot,
    configPath,
    nodePath: "/usr/local/bin/node",
    uid: 501,
    label: "dev.timthink.test",
  });
  let loaded = false;
  const launchctl: CommandRunner = async (command, args) => {
    if (command === "launchctl" && args[0] === "bootstrap") loaded = true;
    const ok = command !== "launchctl" || args[0] !== "print" || loaded;
    const stdout = command.endsWith("timthink-node") ? `${nodeVersion} /usr/local/bin/node\n` : "";
    return { code: ok ? 0 : 113, stdout, stderr: "" };
  };
  return {
    paths,
    launchctl,
    config: () => {
      const config = loadConfig({ TIMTHINK_CONFIG: configPath });
      return { ...config, docsRoot: path.join(home, "agent-docs") };
    },
    deps: (port) => ({
      run: launchctl,
      probePort: async () => port,
      pathEnv: [paths.binDir, zedDir].join(path.delimiter),
    }),
  };
}

const failing = (checks: Awaited<ReturnType<typeof doctorChecks>>): string[] =>
  checks.filter((check) => !check.ok).map((check) => check.name);

describe("doctor", () => {
  it("reports every missing component with a fix before install", async () => {
    const { paths, config, deps } = await machine();
    const checks = await doctorChecks(config(), paths, deps("free"));
    expect(failing(checks)).toEqual(["config", "cli shim", "server", "claude hooks", "skill"]);
    const output = formatChecks(checks);
    expect(output).toMatch(/✗ cli shim\s+.*missing\n\s+→ run `timthink install`/);
    expect(output).toMatch(/✓ node\s+v22\.13\.1 at \/usr\/local\/bin\/node/);
  });

  it("passes everything once installed and the server answers", async () => {
    const { paths, config, deps, launchctl } = await machine();
    await applySteps(await planInstall(paths, { run: launchctl }), launchctl);
    const checks = await doctorChecks(config(), paths, deps("timthink"));
    expect(failing(checks)).toEqual([]);
    expect(formatChecks(checks)).toContain("dev.timthink.test installed, loaded; 127.0.0.1:7420 responding");
  });

  it("flags an old node and a port taken by something else", async () => {
    const { paths, config, deps, launchctl } = await machine("v20.11.0");
    await applySteps(await planInstall(paths, { run: launchctl }), launchctl);
    const checks = await doctorChecks(config(), paths, deps("occupied"));
    expect(failing(checks)).toEqual(["node", "server"]);
  });
});
