import { open, stat, unlink } from "node:fs/promises";

const RETRY_MS = 15;
const TIMEOUT_MS = 3_000;
const STALE_MS = 10_000;

export class LockTimeoutError extends Error {}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function removeIfStale(lockPath: string): Promise<void> {
  const stats = await stat(lockPath).catch(() => null);
  if (stats && Date.now() - stats.mtimeMs > STALE_MS) await unlink(lockPath).catch(() => {});
}

async function acquire(lockPath: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      return;
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) throw error;
      await removeIfStale(lockPath);
      if (Date.now() > deadline) throw new LockTimeoutError(`Timed out waiting for ${lockPath}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

export async function withFileLock<T>(lockPath: string, work: () => Promise<T>): Promise<T> {
  await acquire(lockPath);
  try {
    return await work();
  } finally {
    await unlink(lockPath).catch(() => {});
  }
}
