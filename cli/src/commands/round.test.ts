import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decideRoundItem, loadConfig, RoundStore, submitRound } from "@timthink/server";
import { describe, expect, it } from "vitest";
import { ROUND_ABANDONED_EXIT_CODE, runRound } from "./round.js";

const FIXTURE_DOCS = fileURLToPath(new URL("../../../fixtures/agent-docs", import.meta.url));
const FIXTURE_ROUND = fileURLToPath(new URL("../../../fixtures/rounds/pr-comments.json", import.meta.url));

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "timthink-round-"));
  const docsRoot = path.join(root, "agent-docs");
  await cp(FIXTURE_DOCS, docsRoot, { recursive: true });
  const stateDir = path.join(root, "state");
  const config = { ...loadConfig({ TIMTHINK_CONFIG: "/nonexistent.json" }), docsRoot, stateDir };
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    out: (text: string) => out.push(text),
    err: (text: string) => err.push(text),
    readStdin: async () => "",
  };
  const run = (args: string[]) => runRound({ config, args, io, cwd: root });
  return { run, out, err, store: new RoundStore(stateDir) };
}

async function createdRound(context: Awaited<ReturnType<typeof setup>>) {
  expect(await context.run(["create", FIXTURE_ROUND])).toBe(0);
  const [round] = await context.store.list();
  if (!round) {
    throw new Error("round create wrote nothing");
  }
  return round;
}

async function untilWaiting(store: RoundStore, id: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await store.read(id)).waiter) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("round wait never registered");
}

describe("timthink round", () => {
  it("creates a round in its PR's project, and wait prints the decisions once it's submitted", async () => {
    const context = await setup();
    const round = await createdRound(context);
    expect(round.project).toBe("payments/checkout-v2");

    const waiting = context.run(["wait", round.id]);
    await untilWaiting(context.store, round.id);
    await context.store.update(round.id, (current) =>
      decideRoundItem(current, "1", {
        choice: { kind: "option", optionId: "fix" },
        reply: "Addressed ✅ Skip archived cards.",
      }),
    );
    await context.store.update(round.id, (current) =>
      decideRoundItem(current, "2", { choice: { kind: "other", text: "Reuse it behind a flag" }, reply: "Sure" }),
    );
    await context.store.update(round.id, (current) => submitRound(current, new Date().toISOString()));

    expect(await waiting).toBe(0);
    const printed = JSON.parse(context.out.at(-1) ?? "{}");
    expect(
      printed.decisions.map((entry: Record<string, unknown>) => [
        entry.item,
        entry.decision,
        entry.customFix,
        entry.reply,
      ]),
    ).toEqual([
      ["1", "Fix", null, "Addressed ✅ Skip archived cards."],
      ["2", "Other", "Reuse it behind a flag", "Sure"],
    ]);
    expect((await context.store.read(round.id)).waiter).toBeNull();

    const outcomes = path.join(path.dirname(context.store.dir), "outcomes.json");
    await writeFile(outcomes, JSON.stringify({ "1": { kind: "fixed", commit: "abc1234" }, "2": { kind: "skipped" } }));
    expect(await context.run(["report", round.id, outcomes])).toBe(0);
    expect((await context.store.read(round.id)).state).toBe("done");
  });

  it("ends a wait when the round is abandoned, and refuses invalid input", async () => {
    const context = await setup();
    const round = await createdRound(context);
    const waiting = context.run(["wait", round.id]);
    await untilWaiting(context.store, round.id);
    expect(await context.run(["abandon", round.id])).toBe(0);
    expect(await waiting).toBe(ROUND_ABANDONED_EXIT_CODE);

    expect(await context.run(["report", round.id, FIXTURE_ROUND])).toBe(1);
    expect(await context.run(["wait", "missing-1-abcd"])).toBe(1);
  });
});
