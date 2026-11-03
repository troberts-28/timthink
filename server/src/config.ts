import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { PrLinkHost } from "./docs/types.js";

export const DEFAULT_PORT = 7420;
export const DEFAULT_LAUNCHD_LABEL = "dev.timthink.server";

export const PR_LINK_HOSTS = ["graphite", "github"] as const satisfies readonly PrLinkHost[];
export const DEFAULT_PR_LINK_HOST: PrLinkHost = "graphite";

const repoOverrideSchema = z.object({
  host: z.string().optional(),
  worktrees: z.string().optional(),
  prLinks: z.enum(PR_LINK_HOSTS).optional(),
  aliases: z.array(z.string().min(1)).optional(),
});

const groupSchema = z.object({
  name: z.string().trim().min(1),
  owners: z.array(z.string().min(1)).optional(),
  repos: z.array(z.string().min(1)).optional(),
  default: z.boolean().optional(),
});

const archiveSchema = z.object({
  auto: z.boolean().optional(),
  staleAfterDays: z.number().positive().optional(),
  inFlightStaleAfterDays: z.number().positive().optional(),
  finishedAfterDays: z.number().nonnegative().optional(),
});

const configFileSchema = z.object({
  port: z.number().int().min(1).max(65535).optional(),
  docsRoot: z.string().optional(),
  codeRoot: z.string().optional(),
  stateDir: z.string().optional(),
  claudeProjectsDir: z.string().optional(),
  claudeSessionsDir: z.string().optional(),
  warpTabConfigDir: z.string().optional(),
  userName: z.string().trim().min(1).optional(),
  launchdLabel: z
    .string()
    .regex(/^[A-Za-z0-9][\w.-]*$/)
    .optional(),
  repos: z.record(z.string(), repoOverrideSchema).optional(),
  groups: z.array(groupSchema).optional(),
  sidebarQuotes: z.array(z.string().trim().min(1).max(280)).max(200).optional(),
  archive: archiveSchema.optional(),
  readOnly: z.boolean().optional(),
});

export type ConfigFile = z.infer<typeof configFileSchema>;

export interface RepoOverride {
  host?: string;
  worktrees?: string;
  prLinks?: PrLinkHost;
  aliases?: string[];
}

export interface RepoGroupConfig {
  name: string;
  owners: string[];
  repos: string[];
  default: boolean;
}

export interface ArchiveSettings {
  auto: boolean;
  staleAfterDays: number;
  inFlightStaleAfterDays: number;
  finishedAfterDays: number;
}

export const DEFAULT_ARCHIVE_SETTINGS: ArchiveSettings = {
  auto: true,
  staleAfterDays: 21,
  inFlightStaleAfterDays: 60,
  finishedAfterDays: 3,
};

export interface TimthinkConfig {
  configPath: string;
  configFound: boolean;
  stateDir: string;
  port: number;
  docsRoot: string;
  codeRoot: string;
  claudeProjectsDir: string;
  claudeSessionsDir: string;
  warpTabConfigDir: string;
  userName: string | null;
  launchdLabel: string;
  repos: Record<string, RepoOverride>;
  groups: RepoGroupConfig[] | null;
  sidebarQuotes: string[];
  archive: ArchiveSettings;
  readOnly: boolean;
}

type Env = Record<string, string | undefined>;

export function expandHome(input: string, home: string = homedir()): string {
  if (input === "~") return home;
  if (input.startsWith("~/")) return path.join(home, input.slice(2));
  return input;
}

export function defaultConfigPath(env: Env = process.env): string {
  return env.TIMTHINK_CONFIG ?? path.join(homedir(), ".config", "timthink", "config.json");
}

export function defaultStateDir(env: Env = process.env): string {
  return env.TIMTHINK_STATE_DIR ?? path.join(homedir(), ".local", "state", "timthink");
}

function resolveDir(envValue: string | undefined, fileValue: string | undefined, fallback: string): string {
  return path.resolve(expandHome(envValue ?? fileValue ?? fallback));
}

function readConfigFile(configPath: string): ConfigFile | null {
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    return null;
  }
  const parsed = configFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`Invalid config at ${configPath}: ${parsed.error.message}`);
  }
  return parsed.data;
}

function resolveRepoOverride(override: z.infer<typeof repoOverrideSchema>): RepoOverride {
  const resolved: RepoOverride = {};
  if (override.host) resolved.host = path.resolve(expandHome(override.host));
  if (override.worktrees) resolved.worktrees = expandHome(override.worktrees);
  if (override.prLinks) resolved.prLinks = override.prLinks;
  if (override.aliases) resolved.aliases = override.aliases;
  return resolved;
}

function resolveGroups(groups: ConfigFile["groups"]): RepoGroupConfig[] | null {
  if (!groups || groups.length === 0) return null;
  return groups.map((group) => ({
    name: group.name,
    owners: group.owners ?? [],
    repos: group.repos ?? [],
    default: group.default ?? false,
  }));
}

function isTruthyFlag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function loadConfig(env: Env = process.env): TimthinkConfig {
  const configPath = defaultConfigPath(env);
  const file = readConfigFile(configPath);
  const repos = Object.fromEntries(
    Object.entries(file?.repos ?? {}).map(([name, override]) => [name, resolveRepoOverride(override)]),
  );
  const envPort = env.TIMTHINK_PORT ? Number.parseInt(env.TIMTHINK_PORT, 10) : undefined;
  return {
    configPath,
    configFound: file !== null,
    stateDir: resolveDir(env.TIMTHINK_STATE_DIR, file?.stateDir, "~/.local/state/timthink"),
    port: envPort ?? file?.port ?? DEFAULT_PORT,
    docsRoot: path.resolve(expandHome(file?.docsRoot ?? "~/agent-docs")),
    codeRoot: path.resolve(expandHome(file?.codeRoot ?? "~/code")),
    claudeProjectsDir: resolveDir(env.TIMTHINK_CLAUDE_PROJECTS_DIR, file?.claudeProjectsDir, "~/.claude/projects"),
    claudeSessionsDir: resolveDir(env.TIMTHINK_CLAUDE_SESSIONS_DIR, file?.claudeSessionsDir, "~/.claude/sessions"),
    warpTabConfigDir: resolveDir(env.TIMTHINK_WARP_TAB_CONFIG_DIR, file?.warpTabConfigDir, "~/.warp/tab_configs"),
    userName: file?.userName ?? null,
    launchdLabel: file?.launchdLabel ?? DEFAULT_LAUNCHD_LABEL,
    repos,
    groups: resolveGroups(file?.groups),
    sidebarQuotes: file?.sidebarQuotes ?? [],
    archive: { ...DEFAULT_ARCHIVE_SETTINGS, ...file?.archive },
    readOnly: isTruthyFlag(env.TIMTHINK_READONLY) || (file?.readOnly ?? false),
  };
}

export function prLinkHostFor(config: TimthinkConfig, repo: string): PrLinkHost {
  return config.repos[repo]?.prLinks ?? DEFAULT_PR_LINK_HOST;
}
