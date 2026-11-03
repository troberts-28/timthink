import { createReadStream, type Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { buildRequestInPrompt } from "../build/buildCommand.js";
import { submitCommandIds, submittedPrsIn } from "./submittedPrs.js";
import type { SubmittedPr, TranscriptBuildRequest, TranscriptDocTouch, TranscriptSummary } from "./types.js";

const DOC_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const SESSION_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
const FIRST_PROMPT_MAX_LINE = 256 * 1024;
const FIRST_PROMPT_MAX_CHARS = 140;
const SCAN_CONCURRENCY = 4;
const CACHE_VERSION = 3;
export const BACKFILL_CACHE_FILE = "backfill-cache.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Claude Code writes `timestamp`, `cwd` and `gitBranch` after `message`, so the last occurrence of a key
// is the top-level one rather than one nested in tool input. This avoids parsing multi-megabyte lines.
export function lastStringField(line: string, key: string): string | null {
  const marker = `"${key}":"`;
  const start = line.lastIndexOf(marker);
  if (start === -1) return null;
  let end = start + marker.length;
  while (end < line.length) {
    const char = line[end];
    if (char === "\\") end += 2;
    else if (char === '"') break;
    else end += 1;
  }
  try {
    const value: unknown = JSON.parse(line.slice(start + marker.length - 1, end + 1));
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    return null;
  }
}

const SUBMIT_HINT = /\bgt\s+(?:submit|ss)\b|\bgh\s+pr\s+create\b/;
const BUILD_MARKERS = ["<command-name>/timthink</command-name>", "/timthink build"];

function userContent(entry: Record<string, unknown>): string | null {
  if (entry.type !== "user" || entry.isMeta === true || !isRecord(entry.message)) return null;
  const { content } = entry.message;
  return typeof content === "string" ? content : null;
}

const SLASH_COMMAND =
  /^<command-message>[\s\S]*?<command-name>([^<]+)<\/command-name>(?:\s*<command-args>([^<]*)<\/command-args>)?/;

function slashCommandText(text: string): string | null {
  const match = SLASH_COMMAND.exec(text);
  if (!match?.[1]) return null;
  const args = match[2]?.trim();
  return args ? `${match[1].trim()} ${args}` : null;
}

function promptText(entry: Record<string, unknown>): string | null {
  const text = userContent(entry)?.trim() ?? null;
  if (!text || text.startsWith("Caveat:")) return null;
  if (text.startsWith("<")) return slashCommandText(text);
  const firstLine = text.split("\n", 1)[0] ?? text;
  return firstLine.length > FIRST_PROMPT_MAX_CHARS ? `${firstLine.slice(0, FIRST_PROMPT_MAX_CHARS - 1)}…` : firstLine;
}

interface RootSpelling {
  spelling: string;
  root: string;
}

export function rootSpellings(docsRoots: readonly string[], home = homedir()): RootSpelling[] {
  return docsRoots.flatMap((root) => {
    const spellings = [{ spelling: root, root }];
    if (root.startsWith(`${home}/`)) spellings.push({ spelling: `~${root.slice(home.length)}`, root });
    return spellings;
  });
}

const PATH_TERMINATOR = /[\s"'`<>|;&(){}\\]/;
const TRAILING_PUNCTUATION = /[.,:]+$/;

function stringsIn(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, into);
  else if (isRecord(value)) for (const item of Object.values(value)) stringsIn(item, into);
  return into;
}

export function docPathsMentioned(text: string, spellings: readonly RootSpelling[]): string[] {
  const found = new Set<string>();
  for (const { spelling, root } of spellings) {
    const prefix = `${spelling}/`;
    for (let start = text.indexOf(prefix); start !== -1; start = text.indexOf(prefix, start + prefix.length)) {
      let end = start + prefix.length;
      while (end < text.length && !PATH_TERMINATOR.test(text[end] ?? "")) end += 1;
      const relative = text.slice(start + prefix.length, end).replace(TRAILING_PUNCTUATION, "");
      if (relative.endsWith(".md")) found.add(`${root}/${relative}`);
    }
  }
  return [...found];
}

function docTouchesIn(
  entry: Record<string, unknown>,
  spellings: readonly RootSpelling[],
): { filePath: string; kind: TranscriptDocTouch["kind"] }[] {
  if (entry.type !== "assistant" || !isRecord(entry.message) || !Array.isArray(entry.message.content)) return [];
  const touches: { filePath: string; kind: TranscriptDocTouch["kind"] }[] = [];
  for (const item of entry.message.content) {
    if (!isRecord(item) || item.type !== "tool_use" || typeof item.name !== "string") continue;
    const kind = DOC_WRITE_TOOLS.has(item.name) ? "write" : "use";
    for (const text of stringsIn(item.input)) {
      for (const filePath of docPathsMentioned(text, spellings)) touches.push({ filePath, kind });
    }
  }
  return touches;
}

class TranscriptAccumulator {
  cwd: string | null = null;
  gitBranch: string | null = null;
  firstSeen: string | null = null;
  lastActivity: string | null = null;
  title: string | null = null;
  firstPrompt: string | null = null;
  lineSessionId: string | null = null;
  private readonly touches = new Map<string, TranscriptDocTouch>();
  readonly buildRequests: TranscriptBuildRequest[] = [];
  private readonly submittedPrs = new Map<string, SubmittedPr>();
  private readonly pendingSubmits = new Set<string>();
  private readonly spellings: RootSpelling[];

  constructor(docsRoots: readonly string[]) {
    this.spellings = rootSpellings(docsRoots);
  }

  addLine(line: string): void {
    if (line.startsWith('{"type":"ai-title"')) {
      const entry = parseLine(line);
      if (typeof entry?.aiTitle === "string" && entry.aiTitle.trim()) this.title = entry.aiTitle.trim();
      return;
    }
    if (!line.includes('"cwd":"')) return;
    const timestamp = lastStringField(line, "timestamp");
    this.cwd = lastStringField(line, "cwd") ?? this.cwd;
    this.gitBranch = lastStringField(line, "gitBranch") ?? this.gitBranch;
    this.lineSessionId ??= lastStringField(line, "sessionId");
    if (timestamp) {
      this.firstSeen ??= timestamp;
      if (!this.lastActivity || timestamp > this.lastActivity) this.lastActivity = timestamp;
    }
    const wantsPrompt = this.firstPrompt === null && line.length < FIRST_PROMPT_MAX_LINE && line.includes('"user"');
    const mayTouchDoc = line.includes('"tool_use"') && this.spellings.some(({ spelling }) => line.includes(spelling));
    const mayBuild =
      line.length < FIRST_PROMPT_MAX_LINE && line.includes('"user"') && BUILD_MARKERS.some((m) => line.includes(m));
    const maySubmit = line.includes('"tool_use"') && SUBMIT_HINT.test(line);
    const mayBeSubmitResult =
      this.pendingSubmits.size > 0 &&
      line.includes('"tool_result"') &&
      [...this.pendingSubmits].some((id) => line.includes(id));
    if (!wantsPrompt && !mayTouchDoc && !mayBuild && !maySubmit && !mayBeSubmitResult) return;
    const entry = parseLine(line);
    if (!entry) return;
    if (wantsPrompt) this.firstPrompt = promptText(entry);
    if (maySubmit) for (const id of submitCommandIds(entry)) this.pendingSubmits.add(id);
    if (mayBeSubmitResult) {
      for (const pr of submittedPrsIn(entry, this.pendingSubmits, timestamp)) {
        this.submittedPrs.set(`${pr.owner}/${pr.repo}#${pr.number}`, pr);
      }
    }
    if (mayBuild) {
      const content = userContent(entry);
      const request = content ? buildRequestInPrompt(content) : null;
      if (request) this.buildRequests.push({ request, at: timestamp });
    }
    if (mayTouchDoc) {
      for (const { filePath, kind } of docTouchesIn(entry, this.spellings)) {
        const key = `${kind}:${filePath}`;
        const firstAt = this.touches.get(key)?.firstAt ?? timestamp;
        this.touches.set(key, { filePath, at: timestamp, firstAt, kind });
      }
    }
  }

  prs(): SubmittedPr[] {
    return [...this.submittedPrs.values()];
  }

  docTouches(): TranscriptDocTouch[] {
    return [...this.touches.values()];
  }
}

async function forEachLine(filePath: string, onLine: (line: string) => void): Promise<void> {
  let carry = "";
  for await (const chunk of createReadStream(filePath, { encoding: "utf8", highWaterMark: 1024 * 1024 })) {
    const text = carry + String(chunk);
    let start = 0;
    let newline = text.indexOf("\n", start);
    while (newline !== -1) {
      if (newline > start) onLine(text.slice(start, newline));
      start = newline + 1;
      newline = text.indexOf("\n", start);
    }
    carry = text.slice(start);
  }
  if (carry.trim()) onLine(carry);
}

export function sessionIdFromTranscript(filePath: string): string | null {
  return SESSION_FILE.exec(path.basename(filePath))?.[1] ?? null;
}

export async function scanTranscript(
  transcriptPath: string,
  docsRoots: readonly string[],
): Promise<TranscriptSummary | null> {
  const accumulator = new TranscriptAccumulator(docsRoots);
  try {
    await forEachLine(transcriptPath, (line) => accumulator.addLine(line));
  } catch {
    return null;
  }
  const sessionId = sessionIdFromTranscript(transcriptPath) ?? accumulator.lineSessionId;
  if (!sessionId) return null;
  return {
    sessionId,
    transcriptPath,
    cwd: accumulator.cwd,
    gitBranch: accumulator.gitBranch,
    firstSeen: accumulator.firstSeen,
    lastActivity: accumulator.lastActivity,
    title: accumulator.title,
    firstPrompt: accumulator.firstPrompt,
    docTouches: accumulator.docTouches(),
    buildRequests: accumulator.buildRequests,
    submittedPrs: accumulator.prs(),
  };
}

interface CacheEntry {
  size: number;
  mtimeMs: number;
  summary: TranscriptSummary | null;
}

interface CacheFile {
  version: number;
  docsRoots: string[];
  entries: Record<string, CacheEntry>;
}

export interface BackfillStats {
  files: number;
  scanned: number;
  cached: number;
  durationMs: number;
}

async function listTranscripts(projectsDir: string): Promise<string[]> {
  const projects: Dirent[] = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    projects
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const dir = path.join(projectsDir, entry.name);
        const files: Dirent[] = await readdir(dir, { withFileTypes: true }).catch(() => []);
        return files
          .filter((file) => file.isFile() && SESSION_FILE.test(file.name))
          .map((file) => path.join(dir, file.name));
      }),
  );
  return nested.flat();
}

async function mapWithConcurrency<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function sameRoots(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((root, position) => root === b[position]);
}

export class TranscriptBackfill {
  private entries = new Map<string, CacheEntry>();
  private loaded = false;

  constructor(
    private readonly projectsDir: string,
    private readonly docsRoots: readonly string[],
    private readonly cachePath: string,
  ) {}

  async run(onSummary?: (summary: TranscriptSummary) => void): Promise<BackfillStats> {
    const started = performance.now();
    if (!this.loaded) await this.loadCache();
    const files = await listTranscripts(this.projectsDir);
    const seen = new Set(files);
    for (const known of this.entries.keys()) if (!seen.has(known)) this.entries.delete(known);
    let scanned = 0;
    await mapWithConcurrency(files, SCAN_CONCURRENCY, async (file) => {
      const { rescanned, summary } = await this.refresh(file);
      if (rescanned) scanned += 1;
      if (summary) onSummary?.(summary);
    });
    if (scanned > 0 || !this.loaded) await this.saveCache();
    this.loaded = true;
    return { files: files.length, scanned, cached: files.length - scanned, durationMs: performance.now() - started };
  }

  async refresh(file: string): Promise<{ rescanned: boolean; summary: TranscriptSummary | null }> {
    const stats = await stat(file).catch(() => null);
    if (!stats?.isFile()) return { rescanned: false, summary: null };
    const cached = this.entries.get(file);
    if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
      return { rescanned: false, summary: cached.summary };
    }
    const summary = await scanTranscript(file, this.docsRoots);
    this.entries.set(file, { size: stats.size, mtimeMs: stats.mtimeMs, summary });
    return { rescanned: true, summary };
  }

  async saveCache(): Promise<void> {
    const cache: CacheFile = { version: CACHE_VERSION, docsRoots: [...this.docsRoots], entries: {} };
    for (const [file, entry] of this.entries) cache.entries[file] = entry;
    await mkdir(path.dirname(this.cachePath), { recursive: true });
    const temporary = `${this.cachePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(cache));
    await rename(temporary, this.cachePath);
  }

  private async loadCache(): Promise<void> {
    const text = await readFile(this.cachePath, "utf8").catch(() => null);
    if (!text) return;
    try {
      const cache = JSON.parse(text) as CacheFile;
      if (cache.version !== CACHE_VERSION || !sameRoots(cache.docsRoots, this.docsRoots)) return;
      this.entries = new Map(Object.entries(cache.entries));
    } catch {}
  }
}
