import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { isInside, toPosix } from "../safePath.js";
import { DOC_SESSIONS_LOG, JsonlFollower, parseDocWrite, parseSessionEvent, SESSIONS_LOG } from "./hookLog.js";
import { BACKFILL_CACHE_FILE, type BackfillStats, TranscriptBackfill } from "./transcripts.js";
import type { HookDocWrite, HookSessionEvent, TranscriptSummary } from "./types.js";

export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHORT_ID_LENGTH = 8;

export interface SessionRecord {
  id: string;
  title: string;
  cwd: string | null;
  branch: string | null;
  firstSeen: string | null;
  lastActivity: string | null;
  live: boolean;
  warpFocusUrl: string | null;
  transcriptPath: string | null;
  docPaths: string[];
}

interface SessionState {
  id: string;
  transcript: TranscriptSummary | null;
  latestStart: HookSessionEvent | null;
  latestEndAt: string | null;
  firstHookAt: string | null;
  lastHookAt: string | null;
  hookCwd: string | null;
  hookTranscriptPath: string | null;
  hookDocPaths: Set<string>;
  hookDocWrites: { docPath: string; at: string }[];
}

interface DocWriteTime {
  sessionId: string;
  atMs: number;
}

export interface SessionChange {
  sessionIds: string[];
  docPaths: string[];
}

export interface SessionStoreOptions {
  docsRoot: string;
  stateDir: string;
  claudeProjectsDir: string;
  onChange?: (change: SessionChange) => void;
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function earlier(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function newestFirst(a: SessionRecord, b: SessionRecord): number {
  return (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") || a.id.localeCompare(b.id);
}

export class SessionStore {
  private readonly states = new Map<string, SessionState>();
  private readonly sessionsLog: JsonlFollower;
  private readonly docSessionsLog: JsonlFollower;
  private readonly backfill: TranscriptBackfill;
  private readonly docsRoots: string[];
  private backfillRunning: Promise<BackfillStats> | null = null;
  private backfillDone = false;
  private writeTimes: Map<string, DocWriteTime[]> | null = null;

  constructor(private readonly options: SessionStoreOptions) {
    this.docsRoots = [path.resolve(options.docsRoot)];
    this.sessionsLog = new JsonlFollower(path.join(options.stateDir, SESSIONS_LOG));
    this.docSessionsLog = new JsonlFollower(path.join(options.stateDir, DOC_SESSIONS_LOG));
    this.backfill = this.createBackfill();
  }

  get stateDir(): string {
    return this.options.stateDir;
  }

  get scanning(): boolean {
    return !this.backfillDone;
  }

  async init(): Promise<void> {
    const real = await realpath(this.options.docsRoot).catch(() => null);
    if (real && !this.docsRoots.includes(real)) this.docsRoots.push(real);
    await mkdir(this.options.stateDir, { recursive: true }).catch(() => {});
    await this.readHookLogs();
  }

  async readHookLogs(): Promise<SessionChange> {
    const change = { sessionIds: new Set<string>(), docPaths: new Set<string>() };
    const [sessionLines, docLines] = await Promise.all([this.sessionsLog.readNew(), this.docSessionsLog.readNew()]);
    if (sessionLines.truncated || docLines.truncated) this.clearHookState();
    for (const line of sessionLines.lines) {
      const event = parseSessionEvent(line);
      if (event) this.applySessionEvent(event, change);
    }
    for (const line of docLines.lines) {
      const write = parseDocWrite(line);
      if (write) this.applyDocWrite(write, change);
    }
    return this.finishChange(change);
  }

  runBackfill(): Promise<BackfillStats> {
    this.backfillRunning ??= this.backfill
      .run((summary) => this.applyTranscript(summary))
      .then((stats) => {
        this.backfillDone = true;
        this.notify({ sessionIds: [], docPaths: [] });
        return stats;
      })
      .finally(() => {
        this.backfillRunning = null;
      });
    return this.backfillRunning;
  }

  async refreshTranscripts(sessionIds: readonly string[]): Promise<void> {
    for (const id of sessionIds) {
      const transcriptPath = this.get(id)?.transcriptPath;
      if (transcriptPath) await this.refreshTranscript(transcriptPath);
    }
  }

  async refreshTranscript(transcriptPath: string): Promise<void> {
    if (!isInside(path.resolve(this.options.claudeProjectsDir), path.resolve(transcriptPath))) return;
    const { rescanned, summary } = await this.backfill.refresh(transcriptPath);
    if (!rescanned || !summary) return;
    this.applyTranscript(summary);
    await this.backfill.saveCache().catch(() => {});
    this.notify({ sessionIds: [summary.sessionId], docPaths: this.get(summary.sessionId)?.docPaths ?? [] });
  }

  get(id: string): SessionRecord | null {
    const state = this.states.get(id);
    return state ? this.toRecord(state, this.paneOwners()) : null;
  }

  all(): SessionRecord[] {
    const owners = this.paneOwners();
    return [...this.states.values()].map((state) => this.toRecord(state, owners)).sort(newestFirst);
  }

  forDoc(docPath: string): SessionRecord[] {
    return this.all().filter((session) => session.docPaths.includes(docPath));
  }

  writerNear(docPath: string, atMs: number, windowMs: number): SessionRecord | null {
    let best: { sessionId: string; distance: number } | null = null;
    for (const write of this.docWriteTimes().get(docPath) ?? []) {
      const distance = Math.abs(write.atMs - atMs);
      if (distance <= windowMs && (!best || distance < best.distance)) best = { sessionId: write.sessionId, distance };
    }
    return best ? this.get(best.sessionId) : null;
  }

  private docWriteTimes(): Map<string, DocWriteTime[]> {
    if (this.writeTimes) return this.writeTimes;
    const index = new Map<string, DocWriteTime[]>();
    const add = (docPath: string | null, sessionId: string, at: string | null) => {
      const atMs = at ? Date.parse(at) : Number.NaN;
      if (!docPath || Number.isNaN(atMs)) return;
      const list = index.get(docPath) ?? [];
      list.push({ sessionId, atMs });
      index.set(docPath, list);
    };
    for (const state of this.states.values()) {
      for (const write of state.hookDocWrites) add(write.docPath, state.id, write.at);
      for (const write of state.transcript?.docWrites ?? []) add(this.docPathFor(write.filePath), state.id, write.at);
    }
    this.writeTimes = index;
    return index;
  }

  docPathFor(filePath: string): string | null {
    if (!path.isAbsolute(filePath)) return null;
    for (const root of this.docsRoots) {
      if (isInside(root, filePath) && filePath !== root) return toPosix(path.relative(root, filePath));
    }
    return null;
  }

  private createBackfill(): TranscriptBackfill {
    return new TranscriptBackfill(
      this.options.claudeProjectsDir,
      this.docsRoots,
      path.join(this.options.stateDir, BACKFILL_CACHE_FILE),
    );
  }

  private stateFor(id: string): SessionState {
    let state = this.states.get(id);
    if (!state) {
      state = {
        id,
        transcript: null,
        latestStart: null,
        latestEndAt: null,
        firstHookAt: null,
        lastHookAt: null,
        hookCwd: null,
        hookTranscriptPath: null,
        hookDocPaths: new Set(),
        hookDocWrites: [],
      };
      this.states.set(id, state);
    }
    return state;
  }

  private clearHookState(): void {
    for (const state of this.states.values()) {
      state.latestStart = null;
      state.latestEndAt = null;
      state.firstHookAt = null;
      state.lastHookAt = null;
      state.hookCwd = null;
      state.hookTranscriptPath = null;
      state.hookDocPaths.clear();
      state.hookDocWrites = [];
    }
    this.writeTimes = null;
  }

  private touchHook(state: SessionState, at: string, cwd: string | null, transcriptPath: string | null): void {
    state.firstHookAt = earlier(state.firstHookAt, at);
    state.lastHookAt = later(state.lastHookAt, at);
    if (cwd) state.hookCwd = cwd;
    if (transcriptPath) state.hookTranscriptPath = transcriptPath;
  }

  private applySessionEvent(event: HookSessionEvent, change: { sessionIds: Set<string> }): void {
    const state = this.stateFor(event.sessionId);
    this.touchHook(state, event.at, event.cwd, event.transcriptPath);
    if (event.event === "SessionStart") {
      if (!state.latestStart || event.at >= state.latestStart.at) state.latestStart = event;
    } else {
      state.latestEndAt = later(state.latestEndAt, event.at);
    }
    change.sessionIds.add(event.sessionId);
  }

  private applyDocWrite(write: HookDocWrite, change: { sessionIds: Set<string>; docPaths: Set<string> }): void {
    const docPath = this.docPathFor(write.filePath);
    if (!docPath) return;
    const state = this.stateFor(write.sessionId);
    this.touchHook(state, write.at, write.cwd, write.transcriptPath);
    state.hookDocPaths.add(docPath);
    state.hookDocWrites.push({ docPath, at: write.at });
    this.writeTimes = null;
    change.sessionIds.add(write.sessionId);
    change.docPaths.add(docPath);
  }

  private applyTranscript(summary: TranscriptSummary): void {
    this.stateFor(summary.sessionId).transcript = summary;
    this.writeTimes = null;
  }

  private finishChange(change: { sessionIds: Set<string>; docPaths: Set<string> }): SessionChange {
    for (const id of change.sessionIds) {
      for (const docPath of this.get(id)?.docPaths ?? []) change.docPaths.add(docPath);
    }
    const result = { sessionIds: [...change.sessionIds], docPaths: [...change.docPaths] };
    if (result.sessionIds.length > 0) this.notify(result);
    return result;
  }

  private notify(change: SessionChange): void {
    this.options.onChange?.(change);
  }

  private paneOwners(): Map<string, { id: string; at: string }> {
    const owners = new Map<string, { id: string; at: string }>();
    for (const state of this.states.values()) {
      const start = state.latestStart;
      if (!start?.warpFocusUrl) continue;
      const current = owners.get(start.warpFocusUrl);
      if (!current || start.at > current.at) owners.set(start.warpFocusUrl, { id: state.id, at: start.at });
    }
    return owners;
  }

  private isLive(state: SessionState, owners: Map<string, { id: string }>): boolean {
    const start = state.latestStart;
    if (!start) return false;
    if (state.latestEndAt && state.latestEndAt >= start.at) return false;
    return !start.warpFocusUrl || owners.get(start.warpFocusUrl)?.id === state.id;
  }

  private docPathsOf(state: SessionState): string[] {
    const paths = new Set(state.hookDocPaths);
    for (const write of state.transcript?.docWrites ?? []) {
      const docPath = this.docPathFor(write.filePath);
      if (docPath) paths.add(docPath);
    }
    return [...paths];
  }

  private toRecord(state: SessionState, owners: Map<string, { id: string }>): SessionRecord {
    const { transcript, latestStart } = state;
    const lastDocWrite = (transcript?.docWrites ?? []).reduce<string | null>(
      (latest, write) => later(latest, write.at),
      null,
    );
    return {
      id: state.id,
      title: transcript?.title ?? transcript?.firstPrompt ?? `Session ${state.id.slice(0, SHORT_ID_LENGTH)}`,
      cwd: state.hookCwd ?? transcript?.cwd ?? null,
      branch: transcript?.gitBranch ?? latestStart?.gitBranch ?? null,
      firstSeen: earlier(transcript?.firstSeen ?? null, state.firstHookAt),
      lastActivity: later(later(transcript?.lastActivity ?? null, lastDocWrite), state.lastHookAt),
      live: this.isLive(state, owners),
      warpFocusUrl: latestStart?.warpFocusUrl ?? null,
      transcriptPath: state.hookTranscriptPath ?? transcript?.transcriptPath ?? null,
      docPaths: this.docPathsOf(state),
    };
  }
}
