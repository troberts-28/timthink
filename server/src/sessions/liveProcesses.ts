import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { SESSION_ID_PATTERN } from "./sessionStore.js";

export interface LiveClaudeProcess {
  pid: number;
  sessionId: string;
  updatedAt: number;
  warpFocusUrl: string | null;
}

export type RunPs = (args: string[]) => Promise<string>;

const PS_TIMEOUT_MS = 2000;
const PS_MAX_BUFFER = 16 * 1024 * 1024;
const WARP_FOCUS_URL_IN_ENV = /(?:^|\s)WARP_FOCUS_URL=(warp:\/\/session\/[0-9a-f]{32})(?=\s|$)/;

export function createPsRunner(command = "ps"): RunPs {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(command, args, { timeout: PS_TIMEOUT_MS, maxBuffer: PS_MAX_BUFFER }, (error, stdout) =>
        error && !stdout ? reject(error) : resolve(stdout),
      );
    });
}

interface SessionFile {
  pid: number;
  sessionId: string;
  updatedAt: number;
}

function parseSessionFile(raw: string): SessionFile | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { pid, sessionId, updatedAt } = parsed as Record<string, unknown>;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) return null;
    if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) return null;
    return { pid, sessionId, updatedAt: typeof updatedAt === "number" ? updatedAt : 0 };
  } catch {
    return null;
  }
}

async function readSessionFiles(sessionsDir: string): Promise<SessionFile[] | null> {
  const names = await readdir(sessionsDir).catch(() => null);
  if (names === null) return null;
  const files = await Promise.all(
    names
      .filter((name) => /^\d+\.json$/.test(name))
      .map((name) =>
        readFile(path.join(sessionsDir, name), "utf8")
          .then(parseSessionFile)
          .catch(() => null),
      ),
  );
  return files.filter((file): file is SessionFile => file !== null);
}

function linesByPid(output: string): Map<number, string> {
  const byPid = new Map<number, string>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match?.[1] && match[2] !== undefined) byPid.set(Number(match[1]), match[2]);
  }
  return byPid;
}

function isClaudeCommand(comm: string): boolean {
  return path.basename(comm.trim()) === "claude";
}

export function warpFocusUrlFromEnv(commandWithEnv: string): string | null {
  return WARP_FOCUS_URL_IN_ENV.exec(commandWithEnv)?.[1] ?? null;
}

export async function scanLiveClaudeProcesses(sessionsDir: string, runPs: RunPs): Promise<LiveClaudeProcess[] | null> {
  const files = await readSessionFiles(sessionsDir);
  if (files === null) return null;
  if (files.length === 0) return [];
  const pids = files.map((file) => file.pid).join(",");
  const comms = linesByPid(await runPs(["-o", "pid=,comm=", "-p", pids]).catch(() => ""));
  const alive = files.filter((file) => isClaudeCommand(comms.get(file.pid) ?? ""));
  if (alive.length === 0) return [];
  const environments = linesByPid(
    await runPs(["-wwE", "-o", "pid=,command=", "-p", alive.map((file) => file.pid).join(",")]).catch(() => ""),
  );
  return alive.map((file) => ({
    ...file,
    warpFocusUrl: warpFocusUrlFromEnv(environments.get(file.pid) ?? ""),
  }));
}
