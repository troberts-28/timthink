import type { BuildRequest } from "../build/buildCommand.js";

export interface HookSessionEvent {
  event: "SessionStart" | "SessionEnd";
  sessionId: string;
  at: string;
  cwd: string | null;
  gitBranch: string | null;
  transcriptPath: string | null;
  warpFocusUrl: string | null;
}

export type TurnEventName = "UserPromptSubmit" | "Notification" | "Stop";

export interface HookTurnEvent {
  event: TurnEventName;
  sessionId: string;
  at: string;
  cwd: string | null;
}

export interface SessionLabelEvent {
  event: "Label";
  sessionId: string;
  at: string;
  label: string;
}

export interface SessionBindEvent {
  event: "Bind";
  sessionId: string;
  at: string;
  project: string;
}

export type SessionLogEvent = HookSessionEvent | HookTurnEvent | SessionLabelEvent | SessionBindEvent;

export type SessionStatus = "working" | "waiting" | "finished" | "ended";

export interface HookDocWrite {
  sessionId: string;
  filePath: string;
  cwd: string | null;
  transcriptPath: string | null;
  at: string;
}

export interface TranscriptDocTouch {
  filePath: string;
  at: string | null;
  firstAt: string | null;
  kind: "write" | "use";
}

export interface TranscriptBuildRequest {
  request: BuildRequest;
  at: string | null;
}

export interface SubmittedPr {
  owner: string;
  repo: string;
  number: number;
  branch: string | null;
  at: string | null;
}

export interface TranscriptSummary {
  sessionId: string;
  transcriptPath: string;
  cwd: string | null;
  gitBranch: string | null;
  firstSeen: string | null;
  lastActivity: string | null;
  title: string | null;
  firstPrompt: string | null;
  docTouches: TranscriptDocTouch[];
  buildRequests: TranscriptBuildRequest[];
  submittedPrs: SubmittedPr[];
}

export interface SessionView {
  id: string;
  title: string;
  cwd: string | null;
  branch: string | null;
  firstSeen: string | null;
  lastActivity: string | null;
  live: boolean;
  status: SessionStatus | null;
  warpFocusUrl: string | null;
  canResume: boolean;
  mayBeOpenUntracked: boolean;
  wroteDoc: boolean | null;
  plannedDoc: boolean | null;
  builtDoc: boolean | null;
}

export interface SessionsResponse {
  sessions: SessionView[];
  scanning: boolean;
}
