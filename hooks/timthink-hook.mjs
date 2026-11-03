#!/usr/bin/env node
// Claude Code hook: appends one JSONL line per event to timthink's state dir.
// It must never print to stdout (SessionStart stdout is injected into Claude's context) and always exits 0.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const GIT_TIMEOUT_MS = 1000;
const DOC_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const EVENT_ALIASES = {
  "session-start": "SessionStart",
  "session-end": "SessionEnd",
  "post-tool-use": "PostToolUse",
};

function expandHome(input) {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return path.join(homedir(), input.slice(2));
  return input;
}

function readConfigFile() {
  const configPath = process.env.TIMTHINK_CONFIG ?? path.join(homedir(), ".config", "timthink", "config.json");
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function currentBranch(cwd) {
  if (!cwd) return null;
  try {
    const output = execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return stringOrNull(output.trim());
  } catch {
    return null;
  }
}

function realpathOrSelf(target) {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function appendRecord(stateDir, fileName, record) {
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(path.join(stateDir, fileName), `${JSON.stringify(record)}\n`, { flag: "a" });
}

function sessionRecord(event, input) {
  const cwd = stringOrNull(input.cwd);
  const base = { v: 1, event, sessionId: input.session_id, cwd, at: new Date().toISOString() };
  if (event === "SessionEnd") return { ...base, reason: stringOrNull(input.reason) };
  return {
    ...base,
    source: stringOrNull(input.source),
    gitBranch: currentBranch(cwd),
    transcriptPath: stringOrNull(input.transcript_path),
    warpFocusUrl: stringOrNull(process.env.WARP_FOCUS_URL),
    termProgram: stringOrNull(process.env.TERM_PROGRAM),
  };
}

function docRecord(input, docsRoot) {
  if (!DOC_TOOLS.has(input.tool_name)) return null;
  const filePath = stringOrNull(input.tool_input?.file_path);
  if (!filePath || !path.isAbsolute(filePath)) return null;
  const realFile = realpathOrSelf(filePath);
  const inDocs = [docsRoot, realpathOrSelf(docsRoot)].some(
    (root) => isInside(root, filePath) || isInside(root, realFile),
  );
  if (!inDocs) return null;
  return {
    v: 1,
    sessionId: input.session_id,
    filePath: realFile,
    tool: input.tool_name,
    cwd: stringOrNull(input.cwd),
    transcriptPath: stringOrNull(input.transcript_path),
    at: new Date().toISOString(),
  };
}

function run() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (typeof input !== "object" || input === null || typeof input.session_id !== "string") return;
  const event = EVENT_ALIASES[process.argv[2]] ?? input.hook_event_name;
  const config = readConfigFile();
  const stateDir = path.resolve(
    expandHome(process.env.TIMTHINK_STATE_DIR ?? stringOrNull(config.stateDir) ?? "~/.local/state/timthink"),
  );
  if (event === "SessionStart" || event === "SessionEnd") {
    appendRecord(stateDir, "sessions.jsonl", sessionRecord(event, input));
    return;
  }
  if (event === "PostToolUse") {
    const docsRoot = path.resolve(expandHome(stringOrNull(config.docsRoot) ?? "~/agent-docs"));
    const record = docRecord(input, docsRoot);
    if (record) appendRecord(stateDir, "doc-sessions.jsonl", record);
  }
}

try {
  run();
} catch {}
process.exit(0);
