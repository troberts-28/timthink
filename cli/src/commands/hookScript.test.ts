import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { hookCommand } from "./claudeHooks.js";

const HOOK_SCRIPT = fileURLToPath(new URL("../../../hooks/timthink-hook.mjs", import.meta.url));
const LAUNCHER = fileURLToPath(new URL("../../../bin/timthink-node", import.meta.url));
const SESSION_ID = "7b0b102e-5bdb-4073-a3d3-b16a23b5a701";
const FOCUS_URL = "warp://session/0123456789abcdef0123456789abcdef";

interface HookRun {
  status: number | null;
  stdout: string;
  durationMs: number;
}

describe("timthink-hook.mjs", () => {
  let base: string;
  let stateDir: string;
  let docsRoot: string;
  let env: NodeJS.ProcessEnv;

  const runHook = (argument: string, stdin: string, extraEnv: NodeJS.ProcessEnv = {}): HookRun => {
    const started = performance.now();
    const result = spawnSync(process.execPath, [HOOK_SCRIPT, argument], {
      input: stdin,
      env: { ...env, ...extraEnv },
      encoding: "utf8",
    });
    return { status: result.status, stdout: result.stdout, durationMs: performance.now() - started };
  };

  const readRecords = async (file: string): Promise<Array<Record<string, unknown>>> => {
    const text = await readFile(path.join(stateDir, file), "utf8").catch(() => "");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };

  beforeEach(async () => {
    base = await realpath(await mkdtemp(path.join(tmpdir(), "timthink-hook-")));
    stateDir = path.join(base, "state");
    docsRoot = path.join(base, "agent-docs");
    await mkdir(path.join(docsRoot, "acme-api"), { recursive: true });
    await writeFile(path.join(docsRoot, "acme-api", "plan.md"), "# Plan\n");
    const configPath = path.join(base, "config.json");
    await writeFile(configPath, JSON.stringify({ docsRoot, stateDir }));
    env = {
      PATH: process.env.PATH,
      HOME: base,
      TIMTHINK_CONFIG: configPath,
      WARP_FOCUS_URL: FOCUS_URL,
      TERM_PROGRAM: "WarpTerminal",
    };
  });

  it("records a session start with its branch and Warp focus URL, silently", async () => {
    const checkout = path.join(base, "checkout");
    await mkdir(checkout);
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", checkout, "-c", "user.name=T", "-c", "user.email=t@example.com", ...args]);
    git("init", "-q", "-b", "feat/hooks");
    git("commit", "-q", "--allow-empty", "-m", "init");
    const run = runHook(
      "session-start",
      JSON.stringify({
        session_id: SESSION_ID,
        transcript_path: "/transcripts/x.jsonl",
        cwd: checkout,
        hook_event_name: "SessionStart",
        source: "resume",
      }),
    );
    expect(run).toMatchObject({ status: 0, stdout: "" });
    const [record] = await readRecords("sessions.jsonl");
    expect(record).toMatchObject({
      v: 1,
      event: "SessionStart",
      sessionId: SESSION_ID,
      source: "resume",
      cwd: checkout,
      gitBranch: "feat/hooks",
      transcriptPath: "/transcripts/x.jsonl",
      warpFocusUrl: FOCUS_URL,
      termProgram: "WarpTerminal",
    });
    expect(Number.isNaN(Date.parse(String(record?.at)))).toBe(false);
  });

  it("records a session end with its reason and appends rather than overwrites", async () => {
    const input = { session_id: SESSION_ID, cwd: base, hook_event_name: "SessionEnd", reason: "prompt_input_exit" };
    runHook("session-end", JSON.stringify(input));
    runHook("session-end", JSON.stringify(input));
    const records = await readRecords("sessions.jsonl");
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ event: "SessionEnd", reason: "prompt_input_exit", cwd: base });
  });

  it("records plan writes under docsRoot only", async () => {
    const write = (filePath: string, toolName = "Write") =>
      runHook(
        "post-tool-use",
        JSON.stringify({
          session_id: SESSION_ID,
          cwd: base,
          hook_event_name: "PostToolUse",
          tool_name: toolName,
          tool_input: { file_path: filePath },
          transcript_path: "/t.jsonl",
        }),
      );
    expect(write(path.join(docsRoot, "acme-api", "plan.md"))).toMatchObject({ status: 0, stdout: "" });
    write("/etc/hosts");
    write(path.join(docsRoot, "acme-api", "plan.md"), "Read");
    write(path.join(docsRoot, "..", "agent-docs-evil", "x.md"));
    const records = await readRecords("doc-sessions.jsonl");
    expect(records).toEqual([
      {
        v: 1,
        sessionId: SESSION_ID,
        filePath: path.join(docsRoot, "acme-api", "plan.md"),
        tool: "Write",
        cwd: base,
        transcriptPath: "/t.jsonl",
        at: expect.any(String),
      },
    ]);
  });

  it("normalises plan paths written through a symlink to the docs folder", async () => {
    const link = path.join(base, "docs-link");
    await symlink(docsRoot, link);
    runHook(
      "post-tool-use",
      JSON.stringify({
        session_id: SESSION_ID,
        tool_name: "Edit",
        tool_input: { file_path: path.join(link, "acme-api", "plan.md") },
      }),
    );
    const [record] = await readRecords("doc-sessions.jsonl");
    expect(record?.filePath).toBe(path.join(docsRoot, "acme-api", "plan.md"));
  });

  it("exits 0 without output or records on bad input", async () => {
    for (const stdin of ["", "not json", "[]", JSON.stringify({ cwd: "/x" })]) {
      expect(runHook("session-start", stdin)).toMatchObject({ status: 0, stdout: "" });
    }
    const valid = JSON.stringify({ session_id: SESSION_ID, cwd: base });
    expect(runHook("session-start", valid, { TIMTHINK_STATE_DIR: "/dev/null/not-a-dir" })).toMatchObject({
      status: 0,
      stdout: "",
    });
    expect(await readRecords("sessions.jsonl")).toEqual([]);
  });

  it("runs through the installed hook command, and never fails Claude when node or the checkout is gone", async () => {
    const input = JSON.stringify({ session_id: SESSION_ID, cwd: base });
    const viaShell = (command: string, extraEnv: NodeJS.ProcessEnv = {}) =>
      spawnSync("/bin/sh", ["-c", command], { input, env: { ...env, ...extraEnv }, encoding: "utf8" });
    const installed = hookCommand(LAUNCHER, HOOK_SCRIPT, "session-end");
    expect(viaShell(installed, { TIMTHINK_NODE: process.execPath })).toMatchObject({ status: 0, stdout: "" });
    expect(await readRecords("sessions.jsonl")).toHaveLength(1);
    const noNode = { TIMTHINK_NODE: "", PATH: "/nonexistent", NVM_DIR: "/nonexistent" };
    expect(viaShell(installed, noNode).status).toBe(0);
    expect(viaShell(hookCommand("/moved/bin/timthink-node", HOOK_SCRIPT, "session-end")).status).toBe(0);
  });

  it("runs quickly", () => {
    const input = JSON.stringify({
      session_id: SESSION_ID,
      cwd: base,
      tool_name: "Write",
      tool_input: { file_path: "/x" },
    });
    const durations = Array.from({ length: 3 }, () => runHook("post-tool-use", input).durationMs);
    expect(Math.min(...durations)).toBeLessThan(500);
  });
});
