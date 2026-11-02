export interface HookSessionEvent {
  event: "SessionStart" | "SessionEnd";
  sessionId: string;
  at: string;
  cwd: string | null;
  gitBranch: string | null;
  transcriptPath: string | null;
  warpFocusUrl: string | null;
}

export interface HookDocWrite {
  sessionId: string;
  filePath: string;
  cwd: string | null;
  transcriptPath: string | null;
  at: string;
}

export interface TranscriptDocWrite {
  filePath: string;
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
  docWrites: TranscriptDocWrite[];
}

export interface SessionView {
  id: string;
  title: string;
  cwd: string | null;
  branch: string | null;
  firstSeen: string | null;
  lastActivity: string | null;
  live: boolean;
  warpFocusUrl: string | null;
  canResume: boolean;
}

export interface SessionsResponse {
  sessions: SessionView[];
  scanning: boolean;
}
