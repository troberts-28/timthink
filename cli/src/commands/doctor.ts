import { constants } from "node:fs";
import { access, lstat, readdir, readFile, readlink, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { BIND_HOST, findGh, type TimthinkConfig } from "@timthink/server";
import { SettingsParseError, timthinkHookState } from "./claudeHooks.js";
import {
  type CommandRunner,
  hookScriptPath,
  type InstallPaths,
  isLaunchdLoaded,
  launcherPath,
  plistPath,
  SHIM_MARKER,
  shimPath,
  shimScript,
  skillLinkPath,
  skillSourcePath,
  webBuildExists,
} from "./install.js";

export type PortStatus = "timthink" | "occupied" | "free";

const HEALTH_TIMEOUT_MS = 1500;
const MIN_NODE_MAJOR = 22;
const LAUNCHD_LIKE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const INSTALL_HINT = "run `timthink install` to see the fix, then `--apply`";

export async function probePort(port: number): Promise<PortStatus> {
  try {
    const response = await fetch(`http://${BIND_HOST}:${port}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => null);
    const isTimthink = typeof body === "object" && body !== null && "ok" in body && "docsRoot" in body;
    return isTimthink ? "timthink" : "occupied";
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
    if (cause && "code" in cause && cause.code === "ECONNREFUSED") return "free";
    return "occupied";
  }
}

export async function findOnPath(command: string, pathEnv = process.env.PATH ?? ""): Promise<string | null> {
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  optional?: boolean;
}

export interface DoctorDeps {
  run: CommandRunner;
  probePort: (port: number) => Promise<PortStatus>;
  pathEnv: string;
}

const pass = (name: string, detail: string): DoctorCheck => ({ name, ok: true, detail });
const fail = (name: string, detail: string, fix: string): DoctorCheck => ({ name, ok: false, detail, fix });

function configCheck(config: TimthinkConfig): DoctorCheck {
  return config.configFound
    ? pass("config", config.configPath)
    : fail("config", `${config.configPath} not found (using defaults)`, INSTALL_HINT);
}

async function docsRootCheck(config: TimthinkConfig): Promise<DoctorCheck> {
  const stats = await stat(config.docsRoot).catch(() => null);
  if (!stats?.isDirectory()) {
    return fail("docsRoot", `${config.docsRoot} is missing`, `create it, or set "docsRoot" in ${config.configPath}`);
  }
  const entries = await readdir(config.docsRoot, { withFileTypes: true });
  const repos = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).length;
  return pass("docsRoot", `${config.docsRoot} (${repos} repo folders)`);
}

async function nodeCheck(paths: InstallPaths, deps: DoctorDeps): Promise<DoctorCheck> {
  const env: NodeJS.ProcessEnv = { HOME: paths.home, PATH: LAUNCHD_LIKE_PATH };
  if (process.env.TIMTHINK_CONFIG) env.TIMTHINK_CONFIG = process.env.TIMTHINK_CONFIG;
  const result = await deps.run(launcherPath(paths), ["-p", 'process.version + " " + process.execPath'], env);
  const [version = "", ...execPath] = result.stdout.trim().split(" ");
  if (result.code !== 0 || !version.startsWith("v")) {
    return fail(
      "node",
      `bin/timthink-node found no node: ${result.stderr.trim()}`,
      "set TIMTHINK_NODE or install Node 22+",
    );
  }
  const major = Number.parseInt(version.slice(1), 10);
  const detail = `${version} at ${execPath.join(" ")} (as launchd and hooks resolve it)`;
  return major >= MIN_NODE_MAJOR
    ? pass("node", detail)
    : fail("node", detail, `timthink needs Node ${MIN_NODE_MAJOR}+; set TIMTHINK_NODE or re-run install with it`);
}

async function webCheck(paths: InstallPaths): Promise<DoctorCheck> {
  const dist = path.join(paths.repoRoot, "web", "dist");
  return (await webBuildExists(paths))
    ? pass("web build", dist)
    : fail("web build", `${dist} is missing`, "run `pnpm build`");
}

async function shimCheck(paths: InstallPaths, deps: DoctorDeps): Promise<DoctorCheck> {
  const shim = shimPath(paths);
  const text = await readFile(shim, "utf8").catch(() => null);
  if (text === null) return fail("cli shim", `${shim} is missing`, INSTALL_HINT);
  if (!text.includes(SHIM_MARKER)) return fail("cli shim", `${shim} isn't timthink's`, "move it aside, then install");
  if (text !== shimScript(paths)) return fail("cli shim", `${shim} points at another checkout`, INSTALL_HINT);
  const onPath = deps.pathEnv.split(path.delimiter).includes(paths.binDir);
  return onPath
    ? pass("cli shim", shim)
    : fail("cli shim", `${shim} (${paths.binDir} is not on PATH)`, `add ${paths.binDir} to PATH`);
}

const PORT_DETAIL: Record<PortStatus, string> = {
  timthink: "responding",
  occupied: "in use by another process",
  free: "not responding",
};

const MAC_PROTECTED_FOLDERS = ["Documents", "Desktop", "Downloads"];

function isMacProtectedFolder(folder: string): boolean {
  return MAC_PROTECTED_FOLDERS.some((name) => {
    const relative = path.relative(path.join(homedir(), name), folder);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  });
}

async function serverCheck(config: TimthinkConfig, paths: InstallPaths, deps: DoctorDeps): Promise<DoctorCheck> {
  const plist = plistPath(paths);
  const [plistExists, loaded, port] = await Promise.all([
    stat(plist).then(
      () => true,
      () => false,
    ),
    isLaunchdLoaded(paths, deps.run),
    deps.probePort(config.port),
  ]);
  const detail = `${paths.label} ${plistExists ? "installed" : "not installed"}, ${loaded ? "loaded" : "not loaded"}; ${BIND_HOST}:${config.port} ${PORT_DETAIL[port]}`;
  if (port === "timthink" && loaded) return pass("server", detail);
  if (port === "occupied") return fail("server", detail, `free port ${config.port} or set "port" in the config`);
  if (!plistExists || !loaded) return fail("server", detail, INSTALL_HINT);
  if (isMacProtectedFolder(config.docsRoot)) {
    return fail(
      "server",
      detail,
      `macOS may be waiting for permission to read ${config.docsRoot}: allow "node" in System Settings → Privacy & Security → Files & Folders, then check ${path.join(paths.logsDir, "err.log")}`,
    );
  }
  return fail("server", detail, `check ${path.join(paths.logsDir, "err.log")}`);
}

async function hooksCheck(paths: InstallPaths): Promise<DoctorCheck> {
  const settings = await readFile(paths.claudeSettingsPath, "utf8").catch(() => null);
  try {
    const state = timthinkHookState(settings, launcherPath(paths), hookScriptPath(paths));
    if (state === "installed")
      return pass("claude hooks", `${paths.claudeSettingsPath} (SessionStart, SessionEnd, PostToolUse)`);
    const detail = state === "outdated" ? "installed for another checkout or an older version" : "not installed";
    return fail("claude hooks", detail, INSTALL_HINT);
  } catch (error) {
    if (!(error instanceof SettingsParseError)) throw error;
    return fail("claude hooks", error.message, `fix ${paths.claudeSettingsPath}`);
  }
}

async function skillCheck(paths: InstallPaths): Promise<DoctorCheck> {
  const link = skillLinkPath(paths);
  const stats = await lstat(link).catch(() => null);
  if (!stats) return fail("skill", `${link} is missing`, INSTALL_HINT);
  if (!stats.isSymbolicLink()) return fail("skill", `${link} is not a symlink`, "move it aside, then install");
  const target = await readlink(link);
  return target === skillSourcePath(paths)
    ? pass("skill", `${link} -> ${target}`)
    : fail("skill", `${link} -> ${target}`, INSTALL_HINT);
}

async function zedCheck(deps: DoctorDeps): Promise<DoctorCheck> {
  const zed = await findOnPath("zed", deps.pathEnv);
  return zed
    ? pass("zed", zed)
    : { ...fail("zed", "not on PATH; code links won't open", "Zed > Install CLI"), optional: true };
}

async function ghCheck(config: TimthinkConfig, deps: DoctorDeps): Promise<DoctorCheck> {
  if (!config.prs.enabled) return pass("gh", "PR status is turned off (prs.enabled)");
  const gh = await findGh(config.prs.ghPath);
  const result = await deps
    .run(gh, ["auth", "status"], { HOME: homedir(), PATH: LAUNCHD_LIKE_PATH })
    .catch(() => ({ code: 127, stdout: "", stderr: "not found" }));
  if (result.code === 0) return pass("gh", `${gh} (logged in; PR status and stacks work)`);
  const reason = result.code === 127 ? "not installed" : "not logged in";
  const fix = result.code === 127 ? 'install the GitHub CLI, or set "prs.ghPath"' : "run `gh auth login`";
  return { ...fail("gh", `${gh} ${reason}; PR status is unavailable`, fix), optional: true };
}

export async function doctorChecks(
  config: TimthinkConfig,
  paths: InstallPaths,
  deps: DoctorDeps,
): Promise<DoctorCheck[]> {
  return Promise.all([
    configCheck(config),
    docsRootCheck(config),
    nodeCheck(paths, deps),
    webCheck(paths),
    shimCheck(paths, deps),
    serverCheck(config, paths, deps),
    hooksCheck(paths),
    skillCheck(paths),
    zedCheck(deps),
    ghCheck(config, deps),
  ]);
}

export function formatChecks(checks: readonly DoctorCheck[]): string {
  const width = Math.max(...checks.map((check) => check.name.length));
  return checks
    .map((check) => {
      const line = `${check.ok ? "✓" : "✗"} ${check.name.padEnd(width)}  ${check.detail}`;
      return check.fix && !check.ok ? `${line}\n  ${" ".repeat(width)}  → ${check.fix}` : line;
    })
    .join("\n");
}

export async function doctor(config: TimthinkConfig, paths: InstallPaths, deps: DoctorDeps): Promise<number> {
  const checks = await doctorChecks(config, paths, deps);
  console.log(formatChecks(checks));
  return checks.some((check) => !check.ok && !check.optional) ? 1 : 0;
}
