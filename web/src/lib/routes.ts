function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

export function docHref(docPath: string): string {
  return `/d/${encodePath(docPath)}`;
}

export function repoHref(repo: string): string {
  return `/r/${encodeURIComponent(repo)}`;
}

export function projectHref(repo: string, project: string): string {
  return `/r/${encodeURIComponent(repo)}/${encodeURIComponent(project)}`;
}

export function rawFileHref(filePath: string): string {
  return `/api/raw/${encodePath(filePath)}`;
}

export function resolveRelative(docPath: string, target: string): string | null {
  const segments = docPath.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length <= 1) return null;
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return segments.join("/");
}
