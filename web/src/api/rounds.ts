import type { AppType, RoundDecision, RoundFileContext, RoundView } from "@timthink/server";
import { hc } from "hono/client";
import { NotFoundError, sessionToken, TOKEN_HEADER } from "./client";

const client = hc<AppType>("/");

export async function fetchRound(id: string): Promise<RoundView> {
  const response = await client.api.round.$get({ query: { id } });
  if (response.status === 404) {
    throw new NotFoundError(id);
  }
  if (!response.ok) {
    throw new Error(`Round request failed (${response.status})`);
  }
  const view: RoundView = await response.json();
  return view;
}

export async function fetchRoundFile(id: string, item: string): Promise<RoundFileContext> {
  const response = await client.api.round.file.$get({ query: { id, item } });
  if (!response.ok) {
    throw new Error(`File request failed (${response.status})`);
  }
  const context: RoundFileContext = await response.json();
  return context;
}

export async function saveRoundDecision(id: string, itemId: string, decision: RoundDecision): Promise<RoundView> {
  return roundMutation(
    client.api.round.decision.$post({ json: { id, itemId, decision } }, { headers: await tokenHeaders() }),
    "Couldn't save the decision",
  );
}

export async function submitRound(id: string): Promise<RoundView> {
  return roundMutation(
    client.api.round.submit.$post({ json: { id } }, { headers: await tokenHeaders() }),
    "Couldn't submit the round",
  );
}

export async function abandonRound(id: string): Promise<RoundView> {
  return roundMutation(
    client.api.round.abandon.$post({ json: { id } }, { headers: await tokenHeaders() }),
    "Couldn't abandon the round",
  );
}

async function tokenHeaders() {
  return { [TOKEN_HEADER]: await sessionToken() };
}

async function roundMutation(request: Promise<Response>, failure: string): Promise<RoundView> {
  const response = await request;
  if (!response.ok) {
    const body: { message?: string } = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `${failure} (${response.status})`);
  }
  const view: RoundView = await response.json();
  return view;
}
