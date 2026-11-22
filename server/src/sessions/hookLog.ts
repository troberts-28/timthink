import { appendFile, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { HookDocWrite, SessionBindEvent, SessionLabelEvent, SessionLogEvent } from "./types.js";

export const SESSIONS_LOG = "sessions.jsonl";
export const DOC_SESSIONS_LOG = "doc-sessions.jsonl";

const optionalString = z
  .string()
  .nullish()
  .transform((value) => value || null);

export const MAX_SESSION_LABEL_LENGTH = 120;

const lifecycleEventSchema = z.object({
  event: z.enum(["SessionStart", "SessionEnd"]),
  sessionId: z.string().min(1),
  at: z.string().datetime(),
  cwd: optionalString,
  gitBranch: optionalString,
  transcriptPath: optionalString,
  warpFocusUrl: optionalString,
});

const turnEventSchema = z.object({
  event: z.enum(["UserPromptSubmit", "Notification", "Stop"]),
  sessionId: z.string().min(1),
  at: z.string().datetime(),
  cwd: optionalString,
});

const labelEventSchema = z.object({
  event: z.literal("Label"),
  sessionId: z.string().min(1),
  at: z.string().datetime(),
  label: z.string().trim().min(1).max(MAX_SESSION_LABEL_LENGTH),
});

const bindEventSchema = z.object({
  event: z.literal("Bind"),
  sessionId: z.string().min(1),
  at: z.string().datetime(),
  project: z.string().min(1).max(256),
});

const sessionEventSchema = z.union([lifecycleEventSchema, turnEventSchema, labelEventSchema, bindEventSchema]);

const docWriteSchema = z.object({
  sessionId: z.string().min(1),
  filePath: z.string().min(1),
  cwd: optionalString,
  transcriptPath: optionalString,
  at: z.string().datetime(),
});

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function parseSessionEvent(line: string): SessionLogEvent | null {
  const parsed = sessionEventSchema.safeParse(parseJsonLine(line));
  return parsed.success ? parsed.data : null;
}

export function parseDocWrite(line: string): HookDocWrite | null {
  const parsed = docWriteSchema.safeParse(parseJsonLine(line));
  return parsed.success ? parsed.data : null;
}

export async function appendSessionEvent(stateDir: string, event: SessionLabelEvent | SessionBindEvent) {
  await mkdir(stateDir, { recursive: true });
  await appendFile(path.join(stateDir, SESSIONS_LOG), `${JSON.stringify({ v: 1, ...event })}\n`);
}

export interface FollowResult {
  lines: string[];
  truncated: boolean;
}

export class JsonlFollower {
  private offset = 0;
  private remainder: Buffer = Buffer.alloc(0);

  constructor(readonly filePath: string) {}

  rewind(): void {
    this.offset = 0;
    this.remainder = Buffer.alloc(0);
  }

  async readNew(): Promise<FollowResult> {
    const handle = await open(this.filePath, "r").catch(() => null);
    if (!handle) return { lines: [], truncated: false };
    try {
      const { size } = await handle.stat();
      const truncated = size < this.offset;
      if (truncated) {
        this.offset = 0;
        this.remainder = Buffer.alloc(0);
      }
      if (size === this.offset) return { lines: [], truncated };
      const buffer = Buffer.alloc(size - this.offset);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
      this.offset += bytesRead;
      const bytes = Buffer.concat([this.remainder, buffer.subarray(0, bytesRead)]);
      const lastNewline = bytes.lastIndexOf(0x0a);
      this.remainder = Buffer.from(bytes.subarray(lastNewline + 1));
      const complete = lastNewline === -1 ? "" : bytes.subarray(0, lastNewline).toString("utf8");
      return { lines: complete.split("\n").filter((line) => line.trim() !== ""), truncated };
    } finally {
      await handle.close();
    }
  }
}
