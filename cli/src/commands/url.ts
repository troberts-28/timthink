import path from "node:path";
import { BIND_HOST, type TimthinkConfig } from "@timthink/server";

export class DocOutsideRootError extends Error {}

export function docRelativePath(docsRoot: string, input: string): string {
  const absolute = path.isAbsolute(input) ? input : path.resolve(docsRoot, input);
  const relative = path.relative(docsRoot, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new DocOutsideRootError(`${input} is not inside docsRoot (${docsRoot})`);
  }
  return relative.split(path.sep).join("/");
}

export function docUrlForRelative(config: Pick<TimthinkConfig, "port">, docPath: string): string {
  const encoded = docPath.split("/").map(encodeURIComponent).join("/");
  return `http://${BIND_HOST}:${config.port}/d/${encoded}`;
}

export function docUrl(config: Pick<TimthinkConfig, "docsRoot" | "port">, input: string): string {
  return docUrlForRelative(config, docRelativePath(config.docsRoot, input));
}
