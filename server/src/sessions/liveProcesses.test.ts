import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../test/fixtures.js";
import { type RunPs, scanLiveClaudeProcesses, warpFocusUrlFromEnv } from "./liveProcesses.js";

const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PANE = "warp://session/4037ceb8a7034b1293b20b5ca478f04a";

async function sessionsDir(files: Record<string, unknown>): Promise<string> {
  const dir = path.join(await makeTempDir(), "sessions");
  await mkdir(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(dir, name), typeof contents === "string" ? contents : JSON.stringify(contents));
  }
  return dir;
}

function fakePs(comms: string, environments: string): RunPs {
  return vi.fn(async (args: string[]) => (args.includes("-wwE") ? environments : comms));
}

describe("warpFocusUrlFromEnv", () => {
  it("picks the Warp focus URL out of a process's command and environment", () => {
    expect(warpFocusUrlFromEnv(`claude --resume x TERM=xterm WARP_FOCUS_URL=${PANE} HOME=/Users/me`)).toBe(PANE);
    expect(warpFocusUrlFromEnv("claude WARP_FOCUS_URL=https://evil.example")).toBeNull();
    expect(warpFocusUrlFromEnv(`claude NOT_WARP_FOCUS_URL=${PANE}`)).toBeNull();
  });
});

describe("scanLiveClaudeProcesses", () => {
  it("returns running claude processes with their session and Warp pane", async () => {
    const dir = await sessionsDir({
      "101.json": { pid: 101, sessionId: SESSION_A, updatedAt: 5 },
      "102.json": { pid: 102, sessionId: SESSION_B, updatedAt: 6 },
      "103.json": { pid: 103, sessionId: SESSION_B },
      "104.key": "secret",
      "bad.json": "{",
    });
    const runPs = fakePs(
      "  101 /Users/me/.local/bin/claude\n  102 claude\n  103 node\n",
      `  101 claude WARP_FOCUS_URL=${PANE} PATH=/bin\n  102 claude PATH=/bin\n`,
    );
    expect(await scanLiveClaudeProcesses(dir, runPs)).toEqual([
      { pid: 101, sessionId: SESSION_A, updatedAt: 5, warpFocusUrl: PANE },
      { pid: 102, sessionId: SESSION_B, updatedAt: 6, warpFocusUrl: null },
    ]);
  });

  it("returns null when Claude keeps no session records, and nothing when none are running", async () => {
    expect(await scanLiveClaudeProcesses("/nonexistent/sessions", fakePs("", ""))).toBeNull();
    const dir = await sessionsDir({ "101.json": { pid: 101, sessionId: SESSION_A } });
    expect(await scanLiveClaudeProcesses(dir, fakePs("", ""))).toEqual([]);
  });
});
