import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type GraphqlRunner = (query: string) => Promise<unknown>;

export class GhUnavailableError extends Error {}

const GH_CANDIDATES = [
  "/opt/homebrew/bin/gh",
  "/usr/local/bin/gh",
  path.join(homedir(), "homebrew", "bin", "gh"),
  path.join(homedir(), ".local", "bin", "gh"),
  "/usr/bin/gh",
];
const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 32 * 1024 * 1024;

function isExecutable(file: string): Promise<boolean> {
  return access(file, constants.X_OK).then(
    () => true,
    () => false,
  );
}

export async function findGh(configured: string | null): Promise<string> {
  if (configured) return configured;
  for (const candidate of GH_CANDIDATES) if (await isExecutable(candidate)) return candidate;
  return "gh";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function hasData(value: unknown): boolean {
  return typeof value === "object" && value !== null && "data" in value && value.data !== null;
}

export function createGhRunner(ghPath: () => Promise<string>): GraphqlRunner {
  return async (query) => {
    const gh = await ghPath();
    return new Promise((resolve, reject) => {
      execFile(
        gh,
        ["api", "graphql", "-f", `query=${query}`],
        { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
        (error, stdout, stderr) => {
          const body = parseJson(stdout);
          if (hasData(body)) {
            resolve(body);
            return;
          }
          if (!error) {
            resolve(body);
            return;
          }
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            reject(new GhUnavailableError("The GitHub CLI (gh) isn't installed, so PR status is unavailable"));
            return;
          }
          const message =
            String(stderr || error.message)
              .trim()
              .split("\n")[0] ?? "gh failed";
          if (/auth|login|token/i.test(message)) {
            reject(new GhUnavailableError(`gh isn't logged in: run gh auth login (${message})`));
            return;
          }
          reject(new Error(message));
        },
      );
    });
  };
}
