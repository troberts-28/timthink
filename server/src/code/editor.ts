import { execFile } from "node:child_process";

export type OpenInEditor = (absPath: string, line?: number | null, col?: number | null) => Promise<void>;

export function editorTarget(absPath: string, line?: number | null, col?: number | null): string {
  if (!line) return absPath;
  return col ? `${absPath}:${line}:${col}` : `${absPath}:${line}`;
}

export function createZedOpener(command = "zed"): OpenInEditor {
  return (absPath, line, col) =>
    new Promise((resolve, reject) => {
      execFile(command, [editorTarget(absPath, line, col)], (error) => (error ? reject(error) : resolve()));
    });
}
