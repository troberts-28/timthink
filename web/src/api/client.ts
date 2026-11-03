import type {
  AppType,
  AttachmentSummary,
  DocDetail,
  DocsIndex,
  OpenCodeResponse,
  ResolveCodeResponse,
  SessionActionResponse,
  SessionsResponse,
} from "@timthink/server";
import { hc } from "hono/client";

const TOKEN_META_NAME = "timthink-token";
const TOKEN_HEADER = "x-timthink-token";

const client = hc<AppType>("/");

let tokenPromise: Promise<string> | null = null;

function tokenFromPage(): string | null {
  return document.querySelector<HTMLMetaElement>(`meta[name="${TOKEN_META_NAME}"]`)?.content ?? null;
}

async function fetchSessionToken(): Promise<string> {
  const response = await client.api["session-token"].$get();
  if (!response.ok) throw new Error("Could not obtain a session token");
  return (await response.json()).token;
}

export function sessionToken(): Promise<string> {
  const fromPage = tokenFromPage();
  if (fromPage) return Promise.resolve(fromPage);
  tokenPromise ??= fetchSessionToken().catch((error: unknown) => {
    tokenPromise = null;
    throw error;
  });
  return tokenPromise;
}

export class NotFoundError extends Error {}

// hono/client maps a path segment named "index" to "/", so this one route is fetched directly.
export async function fetchIndex(): Promise<DocsIndex> {
  const response = await fetch("/api/index");
  if (!response.ok) throw new Error(`Index request failed (${response.status})`);
  const index: DocsIndex = await response.json();
  return index;
}

export async function fetchDoc(path: string): Promise<DocDetail> {
  const response = await client.api.doc.$get({ query: { path } });
  if (response.status === 404) throw new NotFoundError(path);
  if (!response.ok) throw new Error(`Doc request failed (${response.status})`);
  return response.json();
}

export async function fetchAttachments(repo: string, project: string | null): Promise<AttachmentSummary[]> {
  const query = project ? { repo, project } : { repo };
  const response = await client.api.attachments.$get({ query });
  if (!response.ok) throw new Error(`Attachments request failed (${response.status})`);
  return (await response.json()).attachments;
}

export async function resolveCode(repo: string, ref: string, docPath: string): Promise<ResolveCodeResponse> {
  const response = await client.api["resolve-code"].$get({ query: { repo, ref, docPath } });
  if (!response.ok) throw new Error(`Resolve request failed (${response.status})`);
  return response.json();
}

export async function openCode(repo: string, ref: string, docPath: string): Promise<OpenCodeResponse> {
  const token = await sessionToken();
  const response = await client.api["open-code"].$post(
    { json: { repo, ref, docPath } },
    { headers: { [TOKEN_HEADER]: token } },
  );
  if (!response.ok) throw new Error(`Open request failed (${response.status})`);
  return response.json();
}

export async function fetchDocSessions(path: string): Promise<SessionsResponse> {
  const response = await client.api["doc-sessions"].$get({ query: { path } });
  if (!response.ok) throw new Error(`Sessions request failed (${response.status})`);
  return response.json();
}

async function sessionActionResult(response: Response): Promise<SessionActionResponse> {
  if (response.status === 404) return { status: "unavailable", message: "This session is no longer known" };
  if (!response.ok) throw new Error(`Session request failed (${response.status})`);
  return response.json();
}

export async function focusSession(id: string): Promise<SessionActionResponse> {
  const token = await sessionToken();
  const response = await client.api.sessions[":id"].focus.$post(
    { param: { id } },
    { headers: { [TOKEN_HEADER]: token } },
  );
  return sessionActionResult(response);
}

export async function resumeSession(id: string, reviewDoc?: string): Promise<SessionActionResponse> {
  const token = await sessionToken();
  const response = await client.api.sessions[":id"].resume.$post(
    { param: { id }, json: reviewDoc === undefined ? {} : { reviewDoc } },
    { headers: { [TOKEN_HEADER]: token } },
  );
  return sessionActionResult(response);
}

export async function revealInFinder(path: string): Promise<boolean> {
  const token = await sessionToken();
  const response = await client.api.reveal.$post({ json: { path } }, { headers: { [TOKEN_HEADER]: token } });
  if (!response.ok) return false;
  const result = await response.json();
  return result.status === "revealed";
}

export async function setRepoHidden(repo: string, hidden: boolean): Promise<boolean> {
  const token = await sessionToken();
  const response = await client.api["repo-visibility"].$post(
    { json: { repo, hidden } },
    { headers: { [TOKEN_HEADER]: token } },
  );
  return response.ok;
}
