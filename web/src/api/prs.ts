import type { PrLookupResponse } from "@timthink/server";
import { sessionToken, TOKEN_HEADER } from "./client";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const token = await sessionToken();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", [TOKEN_HEADER]: token },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export async function lookupPrs(owner: string, repo: string, numbers: readonly number[]): Promise<PrLookupResponse> {
  const query = new URLSearchParams({ owner, repo, numbers: numbers.join(",") });
  const response = await fetch(`/api/prs?${query}`);
  if (!response.ok) throw new Error(`PR lookup failed (${response.status})`);
  return response.json() as Promise<PrLookupResponse>;
}

export interface DocWorktreeResponse {
  worktree: { path: string; name: string } | null;
}

export async function fetchDocWorktree(path: string): Promise<DocWorktreeResponse> {
  const response = await fetch(`/api/doc-worktree?path=${encodeURIComponent(path)}`);
  if (!response.ok) throw new Error(`Worktree request failed (${response.status})`);
  return response.json() as Promise<DocWorktreeResponse>;
}

export function openWorktree(path: string, app: "zed" | "warp"): Promise<{ status: string; message?: string }> {
  return postJson("/api/open-worktree", { path, app });
}
