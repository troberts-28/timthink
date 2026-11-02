import { execFile } from "node:child_process";

export const FALLBACK_USER_NAME = "You";

function gitUserName(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["config", "--get", "user.name"], { timeout: 2_000 }, (error, stdout) => {
      resolve(error ? null : stdout.trim() || null);
    });
  });
}

export function userNameResolver(configured: string | null): () => Promise<string> {
  let cached: Promise<string> | null = null;
  return () => {
    cached ??= configured ? Promise.resolve(configured) : gitUserName().then((name) => name ?? FALLBACK_USER_NAME);
    return cached;
  };
}
