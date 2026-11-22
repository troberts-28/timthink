import type { Round, RoundDecision, RoundOutcome, RoundWaiter } from "./schema.js";

export type RoundErrorCode = "not-found" | "invalid" | "conflict";

export class RoundError extends Error {
  constructor(
    readonly code: RoundErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RoundError";
  }
}

export function decideRoundItem(round: Round, itemId: string, decision: RoundDecision): Round {
  requireState(round, "open", "decided");
  const item = round.items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw new RoundError("not-found", `There is no item ${itemId} in ${round.id}`);
  }
  const { choice } = decision;
  if (choice.kind === "option" && !item.options.some((option) => option.id === choice.optionId)) {
    throw new RoundError("invalid", `Item ${itemId} has no option ${choice.optionId}`);
  }
  return { ...round, decisions: { ...round.decisions, [itemId]: decision } };
}

export function undecidedItems(round: Round) {
  return round.items.filter((item) => !round.decisions[item.id]);
}

export function submitRound(round: Round, now: string): Round {
  requireState(round, "open", "submitted");
  const undecided = undecidedItems(round);
  if (undecided.length > 0) {
    throw new RoundError("invalid", `Decide every item first; ${undecided.length} still open`);
  }
  return { ...round, state: "submitted", submittedAt: now };
}

export function abandonRound(round: Round): Round {
  if (round.state === "done" || round.state === "abandoned") {
    throw new RoundError("conflict", `${round.id} is already ${round.state}`);
  }
  return { ...round, state: "abandoned" };
}

export function setRoundWaiter(round: Round, waiter: RoundWaiter | null): Round {
  return { ...round, waiter };
}

export function reportRoundOutcomes(round: Round, outcomes: Record<string, RoundOutcome>): Round {
  if (round.state !== "submitted" && round.state !== "done") {
    throw new RoundError("conflict", `Outcomes need a submitted round; ${round.id} is ${round.state}`);
  }
  const unknownItems = Object.keys(outcomes).filter((itemId) => !round.items.some((item) => item.id === itemId));
  if (unknownItems.length > 0) {
    throw new RoundError("not-found", `There is no item ${unknownItems.join(", ")} in ${round.id}`);
  }
  const merged = { ...round.outcomes, ...outcomes };
  const everyItemReported = round.items.every((item) => merged[item.id]);
  return { ...round, outcomes: merged, state: everyItemReported ? "done" : round.state };
}

function requireState(round: Round, state: Round["state"], action: string) {
  if (round.state !== state) {
    throw new RoundError("conflict", `${round.id} is ${round.state}, so it can't be ${action}`);
  }
}
