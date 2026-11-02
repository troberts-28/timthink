import { execFile } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { addTimthinkHooks, HOOK_SCRIPT_MARKER, removeTimthinkHooks, SettingsParseError } from "./claudeHooks.js";
import { unifiedDiff } from "./unifiedDiff.js";

export const SHIM_MARKER = "# Managed by `timthink install`.";
const LAUNCHD_THROTTLE_SECONDS = 10;
const UNLOAD_POLL_MS = 100;
const UNLOAD_TIMEOUT_MS = 5000;

export interface InstallPaths {
  home: string;
  repoRoot: string;
  configPath: string;
  binDir: string;
  launchAgentsDir: string;
  logsDir: string;
  skillsDir: string;
  claudeSettingsPath: string;
  nodePath: string;
  uid: number;
  label: string;
}

export interface InstallPathInputs {
  home: string;
  repoRoot: string;
  configPath: string;
  nodePath: string;
  uid: number;
  label: string;
}

export function installPaths({ home, ...rest }: InstallPathInputs): InstallPaths {
  return {
    home,
    binDir: path.join(home, ".local", "bin"),
    launchAgentsDir: path.join(home, "Library", "LaunchAgents"),
    logsDir: path.join(home, "Library", "Logs", "timthink"),
    skillsDir: path.join(home, ".claude", "skills"),
    claudeSettingsPath: path.join(home, ".claude", "settings.json"),
    ...rest,
  };
}

export const launcherPath = (paths: InstallPaths): string => path.join(paths.repoRoot, "bin", "timthink-node");
export const cliEntryPath = (paths: InstallPaths): string => path.join(paths.repoRoot, "cli", "dist", "main.js");
export const hookScriptPath = (paths: InstallPaths): string => path.join(paths.repoRoot, "hooks", HOOK_SCRIPT_MARKER);
export const webIndexPath = (paths: InstallPaths): string => path.join(paths.repoRoot, "web", "dist", "index.html");
export const skillSourcePath = (paths: InstallPaths): string => path.join(paths.repoRoot, "skill");
export const shimPath = (paths: InstallPaths): string => path.join(paths.binDir, "timthink");
export const plistPath = (paths: InstallPaths): string => path.join(paths.launchAgentsDir, `${paths.label}.plist`);
export const skillLinkPath = (paths: InstallPaths): string => path.join(paths.skillsDir, "timthink");
export const nodePathRecord = (paths: InstallPaths): string => path.join(path.dirname(paths.configPath), "node-path");
export const launchdDomain = (paths: InstallPaths): string => `gui/${paths.uid}`;
export const launchdService = (paths: InstallPaths): string => `${launchdDomain(paths)}/${paths.label}`;

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
) => Promise<CommandResult>;

export const runCommand: CommandRunner = (command, args, env) =>
  new Promise((resolve) => {
    execFile(command, [...args], { env: env ?? process.env, timeout: 10_000 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

export async function isLaunchdLoaded(paths: InstallPaths, run: CommandRunner): Promise<boolean> {
  const result = await run("launchctl", ["print", launchdService(paths)]);
  return result.code === 0;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const xmlString = (value: string): string => `<string>${escapeXml(value)}</string>`;

export function launchdPath(home: string): string {
  return [
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");
}

export function launchdPlist(paths: InstallPaths, env: Record<string, string>): string {
  const args = [launcherPath(paths), cliEntryPath(paths), "serve"].map((arg) => `    ${xmlString(arg)}`).join("\n");
  const environment = Object.entries({ PATH: launchdPath(paths.home), ...env })
    .map(([key, value]) => `    <key>${escapeXml(key)}</key>\n    ${xmlString(value)}`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${xmlString(paths.label)}
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  ${xmlString(paths.repoRoot)}
  <key>EnvironmentVariables</key>
  <dict>
${environment}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>${LAUNCHD_THROTTLE_SECONDS}</integer>
  <key>StandardOutPath</key>
  ${xmlString(path.join(paths.logsDir, "out.log"))}
  <key>StandardErrorPath</key>
  ${xmlString(path.join(paths.logsDir, "err.log"))}
</dict>
</plist>
`;
}

export function shimScript(paths: InstallPaths): string {
  const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;
  return `#!/bin/sh\n${SHIM_MARKER}\nexec ${quote(launcherPath(paths))} ${quote(cliEntryPath(paths))} "$@"\n`;
}

export interface ConfigSeed {
  docsRoot?: string;
  codeRoot?: string;
}

export const DEFAULT_CONFIG_SEED = { docsRoot: "~/agent-docs", codeRoot: "~/code" } as const;

function serialiseJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function backupPath(filePath: string, now: Date): string {
  return `${filePath}.timthink-backup-${now.toISOString().replace(/[:.]/g, "-")}`;
}

export type InstallAction =
  | {
      kind: "write-file";
      path: string;
      before: string | null;
      after: string;
      backup: string | null;
      executable: boolean;
    }
  | { kind: "mkdir"; path: string }
  | { kind: "symlink"; path: string; target: string; replaces: string | null }
  | { kind: "remove"; path: string }
  | { kind: "launchd-load"; domain: string; service: string; plist: string; reload: boolean }
  | { kind: "launchd-unload"; service: string }
  | { kind: "ok"; message: string }
  | { kind: "suggest"; message: string }
  | { kind: "blocked"; message: string };

export interface InstallStep {
  label: string;
  action: InstallAction;
}

async function readText(filePath: string): Promise<string | null> {
  return readFile(filePath, "utf8").catch(() => null);
}

async function exists(filePath: string): Promise<boolean> {
  return (await lstat(filePath).catch(() => null)) !== null;
}

function writeStep(
  label: string,
  filePath: string,
  before: string | null,
  after: string,
  options: { executable?: boolean; backup?: string | null } = {},
): InstallStep {
  if (before === after) return { label, action: { kind: "ok", message: `${filePath} is up to date` } };
  return {
    label,
    action: {
      kind: "write-file",
      path: filePath,
      before,
      after,
      backup: before === null ? null : (options.backup ?? null),
      executable: options.executable ?? false,
    },
  };
}

function configSteps(paths: InstallPaths, existing: string | null, seed: ConfigSeed): InstallStep[] {
  const label = "config";
  if (existing === null) {
    const created = { ...DEFAULT_CONFIG_SEED, ...seed };
    return [writeStep(label, paths.configPath, null, serialiseJson(created))];
  }
  const steps: InstallStep[] = [
    { label, action: { kind: "ok", message: `${paths.configPath} exists; leaving it alone` } },
  ];
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return steps;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return steps;
  const current: Record<string, unknown> = { ...parsed };
  const additions = Object.entries(seed).filter(([key, value]) => value !== undefined && current[key] !== value);
  if (additions.length === 0) return steps;
  const suggested = serialiseJson({ ...current, ...Object.fromEntries(additions) });
  const diff = unifiedDiff(existing, suggested, paths.configPath, `${paths.configPath} (suggested)`);
  steps.push({
    label,
    action: {
      kind: "suggest",
      message: `not applied; edit the file by hand if you want these flags:\n${diff.trimEnd()}`,
    },
  });
  return steps;
}

async function shimStep(paths: InstallPaths, pathEnv: string): Promise<InstallStep[]> {
  const label = "cli shim";
  const target = shimPath(paths);
  const before = await readText(target);
  const isForeign = (await exists(target)) && !before?.includes(SHIM_MARKER);
  if (isForeign) {
    return [
      { label, action: { kind: "blocked", message: `${target} exists and wasn't written by timthink; move it aside` } },
    ];
  }
  const steps = [writeStep(label, target, before, shimScript(paths), { executable: true })];
  if (!pathEnv.split(path.delimiter).includes(paths.binDir)) {
    steps.push({
      label,
      action: { kind: "suggest", message: `${paths.binDir} is not on your PATH; add it to use \`timthink\`` },
    });
  }
  return steps;
}

async function skillStep(paths: InstallPaths): Promise<InstallStep> {
  const label = "skill";
  const link = skillLinkPath(paths);
  const target = skillSourcePath(paths);
  const existing = await lstat(link).catch(() => null);
  if (existing && !existing.isSymbolicLink()) {
    return { label, action: { kind: "blocked", message: `${link} exists and is not a symlink; move it aside` } };
  }
  const current = existing ? await readlink(link) : null;
  if (current === target) return { label, action: { kind: "ok", message: `${link} -> ${target}` } };
  return { label, action: { kind: "symlink", path: link, target, replaces: current } };
}

function settingsStep(
  paths: InstallPaths,
  before: string | null,
  after: () => string | null,
  unchanged: string,
  now: Date,
): InstallStep {
  const label = "claude hooks";
  let next: string | null;
  try {
    next = after();
  } catch (error) {
    if (!(error instanceof SettingsParseError)) throw error;
    return { label, action: { kind: "blocked", message: `${paths.claudeSettingsPath}: ${error.message}` } };
  }
  if (next === null || next === before) {
    return { label, action: { kind: "ok", message: `${paths.claudeSettingsPath} ${unchanged}` } };
  }
  return writeStep(label, paths.claudeSettingsPath, before, next, {
    backup: backupPath(paths.claudeSettingsPath, now),
  });
}

export interface InstallOptions {
  run: CommandRunner;
  seed?: ConfigSeed;
  pathEnv?: string;
  env?: Record<string, string>;
  now?: Date;
}

export async function planInstall(paths: InstallPaths, options: InstallOptions): Promise<InstallStep[]> {
  const now = options.now ?? new Date();
  const steps: InstallStep[] = [];
  if (!(await webBuildExists(paths))) {
    steps.push({
      label: "web build",
      action: { kind: "blocked", message: `${path.dirname(webIndexPath(paths))} is missing; run \`pnpm build\` first` },
    });
  }
  steps.push(...configSteps(paths, await readText(paths.configPath), options.seed ?? {}));
  steps.push(
    writeStep("node path", nodePathRecord(paths), await readText(nodePathRecord(paths)), `${paths.nodePath}\n`),
  );
  steps.push(...(await shimStep(paths, options.pathEnv ?? "")));
  steps.push(
    (await exists(paths.logsDir))
      ? { label: "logs", action: { kind: "ok", message: `${paths.logsDir} exists` } }
      : { label: "logs", action: { kind: "mkdir", path: paths.logsDir } },
  );
  steps.push(
    writeStep(
      "launchd agent",
      plistPath(paths),
      await readText(plistPath(paths)),
      launchdPlist(paths, options.env ?? {}),
    ),
  );
  steps.push(await skillStep(paths));
  const settings = await readText(paths.claudeSettingsPath);
  steps.push(
    settingsStep(
      paths,
      settings,
      () => addTimthinkHooks(settings, launcherPath(paths), hookScriptPath(paths)),
      "is up to date",
      now,
    ),
  );
  steps.push({
    label: "launchd agent",
    action: {
      kind: "launchd-load",
      domain: launchdDomain(paths),
      service: launchdService(paths),
      plist: plistPath(paths),
      reload: await isLaunchdLoaded(paths, options.run),
    },
  });
  return steps;
}

export async function planUninstall(
  paths: InstallPaths,
  options: Pick<InstallOptions, "run" | "now">,
): Promise<InstallStep[]> {
  const now = options.now ?? new Date();
  const steps: InstallStep[] = [];
  steps.push(
    (await isLaunchdLoaded(paths, options.run))
      ? { label: "launchd agent", action: { kind: "launchd-unload", service: launchdService(paths) } }
      : { label: "launchd agent", action: { kind: "ok", message: `${launchdService(paths)} is not loaded` } },
  );
  const removable = async (label: string, filePath: string, isOurs: () => Promise<boolean>): Promise<InstallStep> => {
    if (!(await exists(filePath))) return { label, action: { kind: "ok", message: `${filePath} is already gone` } };
    if (!(await isOurs()))
      return { label, action: { kind: "suggest", message: `${filePath} isn't timthink's; leaving it` } };
    return { label, action: { kind: "remove", path: filePath } };
  };
  steps.push(await removable("launchd agent", plistPath(paths), async () => true));
  steps.push(
    await removable(
      "cli shim",
      shimPath(paths),
      async () => (await readText(shimPath(paths)))?.includes(SHIM_MARKER) ?? false,
    ),
  );
  steps.push(
    await removable("skill", skillLinkPath(paths), async () => {
      const link = await lstat(skillLinkPath(paths));
      return link.isSymbolicLink() && (await readlink(skillLinkPath(paths))) === skillSourcePath(paths);
    }),
  );
  const settings = await readText(paths.claudeSettingsPath);
  steps.push(settingsStep(paths, settings, () => removeTimthinkHooks(settings), "has no timthink hooks", now));
  steps.push(await removable("node path", nodePathRecord(paths), async () => true));
  steps.push({
    label: "kept",
    action: {
      kind: "suggest",
      message: `${paths.configPath}, ${paths.logsDir}, the state dir and review data under docsRoot are left in place`,
    },
  });
  return steps;
}

const STEP_SYMBOLS: Record<InstallAction["kind"], string> = {
  "write-file": "+",
  mkdir: "+",
  symlink: "+",
  remove: "-",
  "launchd-load": "+",
  "launchd-unload": "-",
  ok: "✓",
  suggest: "!",
  blocked: "✗",
};

function indent(text: string, by: string): string {
  return text.replace(/^/gm, by);
}

export function describeAction(action: InstallAction): string {
  switch (action.kind) {
    case "write-file": {
      if (action.before === null) return `create ${action.path}\n${indent(action.after.trimEnd(), "  ")}`;
      const diff = unifiedDiff(action.before, action.after, action.path, `${action.path} (after)`).trimEnd();
      const backup = action.backup ? ` (backing up to ${action.backup})` : "";
      return `update ${action.path}${backup}\n${indent(diff, "  ")}`;
    }
    case "mkdir":
      return `create directory ${action.path}`;
    case "symlink":
      return `link ${action.path} -> ${action.target}${action.replaces ? ` (was -> ${action.replaces})` : ""}`;
    case "remove":
      return `remove ${action.path}`;
    case "launchd-load": {
      const bootstrap = `run launchctl bootstrap ${action.domain} ${action.plist}`;
      return action.reload ? `run launchctl bootout ${action.service} (it is loaded), then\n${bootstrap}` : bootstrap;
    }
    case "launchd-unload":
      return `run launchctl bootout ${action.service}`;
    case "ok":
    case "suggest":
    case "blocked":
      return action.message;
  }
}

export function describeSteps(steps: readonly InstallStep[]): string {
  const width = Math.max(...steps.map((step) => step.label.length));
  return steps
    .map(({ label, action }) => {
      const [first = "", ...rest] = describeAction(action).split("\n");
      const head = `${STEP_SYMBOLS[action.kind]} ${label.padEnd(width)}  ${first}`;
      return [head, ...rest.map((line) => `${" ".repeat(width + 4)}${line}`)].join("\n");
    })
    .join("\n");
}

export const isBlocked = (steps: readonly InstallStep[]): boolean =>
  steps.some((step) => step.action.kind === "blocked");

async function writeFileAction(action: Extract<InstallAction, { kind: "write-file" }>): Promise<void> {
  const current = await readText(action.path);
  if (current !== action.before) {
    throw new Error(`${action.path} changed since the plan was computed; re-run to see the new plan`);
  }
  await mkdir(path.dirname(action.path), { recursive: true });
  if (current !== null && action.backup) await copyFile(action.path, action.backup);
  await writeFile(action.path, action.after);
  if (action.executable) await chmod(action.path, 0o755);
}

async function linkAction(action: Extract<InstallAction, { kind: "symlink" }>): Promise<void> {
  const existing = await lstat(action.path).catch(() => null);
  if (existing && !existing.isSymbolicLink()) throw new Error(`${action.path} exists and is not a symlink`);
  if (existing) await rm(action.path);
  await mkdir(path.dirname(action.path), { recursive: true });
  await symlink(action.target, action.path);
}

async function launchctl(run: CommandRunner, args: string[]): Promise<void> {
  const result = await run("launchctl", args);
  if (result.code !== 0) {
    throw new Error(`launchctl ${args.join(" ")} failed (${result.code}): ${(result.stderr || result.stdout).trim()}`);
  }
}

async function waitUntilUnloaded(service: string, run: CommandRunner): Promise<void> {
  const deadline = Date.now() + UNLOAD_TIMEOUT_MS;
  while ((await run("launchctl", ["print", service])).code === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, UNLOAD_POLL_MS));
  }
}

async function applyAction(action: InstallAction, run: CommandRunner): Promise<void> {
  switch (action.kind) {
    case "write-file":
      return writeFileAction(action);
    case "mkdir":
      await mkdir(action.path, { recursive: true });
      return;
    case "symlink":
      return linkAction(action);
    case "remove":
      await rm(action.path, { force: true });
      return;
    case "launchd-load":
      if (action.reload) {
        await launchctl(run, ["bootout", action.service]);
        await waitUntilUnloaded(action.service, run);
      }
      return launchctl(run, ["bootstrap", action.domain, action.plist]);
    case "launchd-unload":
      await launchctl(run, ["bootout", action.service]);
      return waitUntilUnloaded(action.service, run);
    case "ok":
    case "suggest":
    case "blocked":
      return;
  }
}

export async function applySteps(steps: readonly InstallStep[], run: CommandRunner): Promise<void> {
  const blocked = steps.filter((step) => step.action.kind === "blocked");
  if (blocked.length > 0) {
    throw new Error(
      `Nothing was changed. Fix these first:\n${blocked.map((step) => `  ${describeAction(step.action)}`).join("\n")}`,
    );
  }
  for (const step of steps) await applyAction(step.action, run);
}

export async function webBuildExists(paths: InstallPaths): Promise<boolean> {
  return (await stat(webIndexPath(paths)).catch(() => null))?.isFile() ?? false;
}
