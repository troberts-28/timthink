import { execFile } from "node:child_process";

export type RevealInFinder = (absPath: string) => Promise<void>;

export function createFinderRevealer(command = "open"): RevealInFinder {
  return (absPath) =>
    new Promise((resolve, reject) => {
      execFile(command, ["-R", absPath], (error) => (error ? reject(error) : resolve()));
    });
}
