import type { SearchHit } from "@timthink/server";

export async function searchPlans(query: string): Promise<SearchHit[]> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  return ((await response.json()) as { hits: SearchHit[] }).hits;
}
