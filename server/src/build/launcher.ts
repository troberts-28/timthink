import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { type BuildRequest, buildSlashCommand } from "./buildCommand.js";

export type BuildLauncher = (argv: readonly string[]) => Promise<void>;

const LAUNCH_TIMEOUT_MS = 60_000;
const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", path.join(homedir(), ".local", "bin")];

export function launchArgv(template: readonly string[], request: BuildRequest, branch: string): string[] {
  const values: Record<string, string> = { branch, prompt: buildSlashCommand(request), doc: request.doc };
  return template.map((part) => part.replace(/\{(branch|prompt|doc)\}/g, (_, key: string) => values[key] ?? ""));
}

export function createBuildLauncher(): BuildLauncher {
  return ([command, ...args]) =>
    new Promise((resolve, reject) => {
      if (!command) {
        reject(new Error("The build launcher has no command"));
        return;
      }
      const env = { ...process.env, PATH: [...EXTRA_PATH, process.env.PATH ?? ""].join(path.delimiter) };
      execFile(command, args, { env, timeout: LAUNCH_TIMEOUT_MS }, (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const detail = String(stderr).trim().split("\n").at(-1) || error.message;
        reject(new Error(detail));
      });
    });
}
