import { execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { shellQuote } from "../build/buildCommand.js";
import { SESSION_ID_PATTERN } from "./sessionStore.js";

export type OpenUrl = (url: string) => Promise<void>;

export const RESUME_TAB_CONFIG_NAME = "timthink-resume";
export const RESUME_TAB_CONFIG_URL = `warp://tab_config/${RESUME_TAB_CONFIG_NAME}`;
const WARP_FOCUS_URL = /^warp:\/\/session\/[0-9a-f]{32}$/;

export function createMacOpener(command = "open"): OpenUrl {
  return (url) =>
    new Promise((resolve, reject) => {
      execFile(command, [url], (error) => (error ? reject(error) : resolve()));
    });
}

export function isWarpFocusUrl(url: string | null): url is string {
  return url !== null && WARP_FOCUS_URL.test(url);
}

export function isSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}

const TOML_ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
};

export function tomlString(value: string): string {
  let escaped = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const known = TOML_ESCAPES[char];
    if (known) escaped += known;
    else if (code < 0x20 || code === 0x7f) escaped += `\\u${code.toString(16).padStart(4, "0")}`;
    else escaped += char;
  }
  return `"${escaped}"`;
}

export function resumeCommand(sessionId: string, prompt: string | null = null): string {
  const resume = `claude --resume ${sessionId}`;
  return prompt ? `${resume} ${shellQuote(prompt)}` : resume;
}

export function resumeTabConfig(sessionId: string, cwd: string, prompt: string | null = null): string {
  if (!isSessionId(sessionId)) throw new Error("Invalid session id");
  if (!path.isAbsolute(cwd)) throw new Error("The session's directory must be an absolute path");
  return `name = ${tomlString(RESUME_TAB_CONFIG_NAME)}

[[panes]]
id = "main"
type = "terminal"
directory = ${tomlString(cwd)}
is_focused = true
commands = [${tomlString(resumeCommand(sessionId, prompt))}]
`;
}

export async function isExistingDirectory(candidate: string | null): Promise<boolean> {
  if (!candidate || !path.isAbsolute(candidate)) return false;
  return (await stat(candidate).catch(() => null))?.isDirectory() ?? false;
}

export async function writeResumeTabConfig(
  tabConfigDir: string,
  sessionId: string,
  cwd: string,
  prompt: string | null = null,
): Promise<string> {
  const contents = resumeTabConfig(sessionId, cwd, prompt);
  await mkdir(tabConfigDir, { recursive: true });
  const target = path.join(tabConfigDir, `${RESUME_TAB_CONFIG_NAME}.toml`);
  await writeFile(target, contents);
  return target;
}
