import { realpath } from "node:fs/promises";
import path from "node:path";

export class PathOutsideRootError extends Error {
  constructor(requested: string) {
    super(`Path is outside the allowed root: ${requested}`);
    this.name = "PathOutsideRootError";
  }
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export async function resolveInsideRoot(root: string, requested: string): Promise<string> {
  if (requested.includes("\0") || path.isAbsolute(requested)) throw new PathOutsideRootError(requested);
  const realRoot = await realpath(root);
  const lexical = path.resolve(realRoot, requested);
  if (!isInside(realRoot, lexical)) throw new PathOutsideRootError(requested);
  const real = await realpath(lexical);
  if (!isInside(realRoot, real)) throw new PathOutsideRootError(requested);
  return real;
}

export async function isRealPathInsideAny(roots: readonly string[], candidate: string): Promise<boolean> {
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    return false;
  }
  for (const root of roots) {
    const realRoot = await realpath(root).catch(() => null);
    if (realRoot && isInside(realRoot, real)) return true;
  }
  return false;
}
