import { open } from "node:fs/promises";
import { z } from "zod";
import type { HookDocWrite, HookSessionEvent } from "./types.js";

export const SESSIONS_LOG = "sessions.jsonl";
export const DOC_SESSIONS_LOG = "doc-sessions.jsonl";

const optionalString = z
  .string()
  .nullish()
  .transform((value) => value || null);

const sessionEventSchema = z.object({
  event: z.enum(["SessionStart", "SessionEnd"]),
  sessionId: z.string().min(1),
  at: z.string().datetime(),
  cwd: optionalString,
  gitBranch: optionalString,
  transcriptPath: optionalString,
  warpFocusUrl: optionalString,
});

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

export function parseSessionEvent(line: string): HookSessionEvent | null {
  const parsed = sessionEventSchema.safeParse(parseJsonLine(line));
  return parsed.success ? parsed.data : null;
}

export function parseDocWrite(line: string): HookDocWrite | null {
  const parsed = docWriteSchema.safeParse(parseJsonLine(line));
  return parsed.success ? parsed.data : null;
}

export interface FollowResult {
  lines: string[];
  truncated: boolean;
}

export class JsonlFollower {
  private offset = 0;
  private remainder: Buffer = Buffer.alloc(0);

  constructor(readonly filePath: string) {}

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
