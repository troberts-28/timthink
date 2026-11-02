import type { AppType, DocHistory, InboxResponse, SeenResponse } from "@timthink/server";
import { hc } from "hono/client";
import { NotFoundError, sessionToken } from "./client";

const TOKEN_HEADER = "x-timthink-token";
const client = hc<AppType>("/");

async function authHeaders(): Promise<{ headers: Record<string, string> }> {
  return { headers: { [TOKEN_HEADER]: await sessionToken() } };
}

export async function fetchHistory(path: string): Promise<DocHistory> {
  const response = await client.api.history.$get({ query: { path } });
  if (response.status === 404) throw new NotFoundError(path);
  if (!response.ok) throw new Error(`History request failed (${response.status})`);
  return response.json();
}

export async function fetchSnapshot(path: string, id: string): Promise<string> {
  const response = await client.api.history.snapshot.$get({ query: { path, id } });
  if (response.status === 404) throw new NotFoundError(`${path}@${id}`);
  if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
  return (await response.json()).raw;
}

export async function markSeen(path: string, hash: string): Promise<SeenResponse> {
  const response = await client.api.seen.$post({ json: { path, hash } }, await authHeaders());
  if (!response.ok) throw new Error(`Couldn't mark the plan as seen (${response.status})`);
  return response.json();
}

export async function markUnseen(path: string): Promise<SeenResponse> {
  const response = await client.api.seen.unseen.$post({ json: { path } }, await authHeaders());
  if (!response.ok) throw new Error(`Couldn't mark the plan as unseen (${response.status})`);
  return response.json();
}

export async function markThreadRead(path: string, threadId: string): Promise<void> {
  const response = await client.api.seen.thread.$post({ json: { path, threadId } }, await authHeaders());
  if (!response.ok) throw new Error(`Couldn't mark the thread as read (${response.status})`);
}

export async function fetchInbox(): Promise<InboxResponse> {
  const response = await client.api.inbox.$get();
  if (!response.ok) throw new Error(`Inbox request failed (${response.status})`);
  return response.json();
}
