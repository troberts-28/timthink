import { readFile, writeFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import type { InboxResponse } from "../inbox/types.js";
import { TOKEN_HEADER } from "../security.js";
import { createRuntime, type Runtime } from "../server.js";
import { copyFixtureDocs, FIXTURE_ROUND, makeTempDir, testConfig } from "../test/fixtures.js";
import { createGitRepo, git } from "../test/gitRepo.js";
import type { RoundSummary, RoundView } from "./roundView.js";
import type { RoundFileContext } from "./routes.js";
import type { Round } from "./schema.js";

const BASE = "http://127.0.0.1:7420";
const SAVED_CARDS = "src/checkout/savedCards.ts";

describe("rounds API", () => {
  let runtime: Runtime;
  let round: Round;

  const get = async <T>(url: string) => (await runtime.app.request(`${BASE}${url}`)).json() as Promise<T>;
  const post = (url: string, body: unknown) =>
    runtime.app.request(`${BASE}${url}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: BASE, [TOKEN_HEADER]: runtime.token },
    });
  const decide = (itemId: string, optionId: string, reply = "") =>
    post("/api/round/decision", { id: round.id, itemId, decision: { choice: { kind: "option", optionId }, reply } });
  const inboxIds = async () => (await get<InboxResponse>("/api/inbox")).items.map((item) => item.id);

  beforeAll(async () => {
    const { codeRoot, checkout } = await createGitRepo("acme-api", [SAVED_CARDS]);
    const numbered = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join("\n");
    await writeFile(`${checkout}/${SAVED_CARDS}`, numbered);
    git(checkout, "commit", "-qam", "numbered");
    const headSha = git(checkout, "rev-parse", "HEAD").trim();

    const stateDir = await makeTempDir("timthink-state-");
    runtime = await createRuntime({
      config: testConfig({ docsRoot: await copyFixtureDocs(), stateDir, codeRoot }),
      webDist: null,
    });
    const input = JSON.parse(await readFile(FIXTURE_ROUND, "utf8"));
    input.prs[0].headSha = headSha;
    round = await runtime.rounds.create({
      input,
      repo: "acme-api",
      project: "payments/checkout-v2",
      cwd: null,
      now: new Date().toISOString(),
    });
  });

  it("lists an open round in the inbox and on its own page, with code at the PR head", async () => {
    expect(await inboxIds()).toContain(`round:${round.id}`);
    const { rounds } = await get<{ rounds: RoundSummary[] }>("/api/round/list");
    expect(rounds.map((entry) => [entry.id, entry.state, entry.itemCount, entry.waiting])).toEqual([
      [round.id, "open", 2, false],
    ]);
    const view = await get<RoundView>(`/api/round?id=${round.id}`);
    expect(view.resumePrompt).toBe(`/timthink comments --round ${round.id}`);

    const file = await get<RoundFileContext>(`/api/round/file?id=${round.id}&item=1`);
    expect(file).toMatchObject({ status: "ok", startLine: 32, line: 42 });
    expect(file.status === "ok" && file.lines.at(10)).toBe("line 42");
    expect((await get<RoundFileContext>(`/api/round/file?id=${round.id}&item=2`)).status).toBe("unavailable");
  });

  it("saves decisions as you go and submits once every item is decided", async () => {
    expect((await decide("1", "not-an-option")).status).toBe(422);
    expect((await decide("1", "fix", "Addressed ✅ Skip archived cards.")).status).toBe(200);
    expect((await post("/api/round/submit", { id: round.id })).status).toBe(422);
    expect((await decide("2", "no-change", "The old picker can't list saved cards.")).status).toBe(200);

    expect((await post("/api/round/submit", { id: round.id })).status).toBe(200);
    const view = await get<RoundView>(`/api/round?id=${round.id}`);
    expect(view.round.state).toBe("submitted");
    expect(view.round.decisions["2"]?.reply).toBe("The old picker can't list saved cards.");
    expect(await inboxIds()).not.toContain(`round:${round.id}`);
    expect((await decide("1", "defer")).status).toBe(409);
  });

  it("abandons a round and 404s an unknown one", async () => {
    expect((await post("/api/round/abandon", { id: round.id })).status).toBe(200);
    expect((await get<RoundView>(`/api/round?id=${round.id}`)).round.state).toBe("abandoned");
    expect((await post("/api/round/abandon", { id: round.id })).status).toBe(409);
    expect((await runtime.app.request(`${BASE}/api/round?id=missing-1-abcd`)).status).toBe(404);
  });
});
