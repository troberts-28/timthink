import type { DocPrsResponse, PrLookupResponse } from "@timthink/server";
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

export async function fetchDocPrs(path: string): Promise<DocPrsResponse> {
  const response = await fetch(`/api/doc-prs?path=${encodeURIComponent(path)}`);
  if (!response.ok) throw new Error(`PR request failed (${response.status})`);
  return response.json() as Promise<DocPrsResponse>;
}

export function refreshDocPrs(path: string): Promise<DocPrsResponse> {
  return postJson("/api/doc-prs/refresh", { path });
}

export function setPrUnlinked(path: string, number: number, unlinked: boolean): Promise<DocPrsResponse> {
  return postJson("/api/doc-prs/unlink", { path, number, unlinked });
}

export async function lookupPrs(owner: string, repo: string, numbers: readonly number[]): Promise<PrLookupResponse> {
  const query = new URLSearchParams({ owner, repo, numbers: numbers.join(",") });
  const response = await fetch(`/api/prs?${query}`);
  if (!response.ok) throw new Error(`PR lookup failed (${response.status})`);
  return response.json() as Promise<PrLookupResponse>;
}
