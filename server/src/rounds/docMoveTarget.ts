import type { DocMoveItem, RoundDecision } from "./schema.js";

export function docMoveTarget(item: DocMoveItem, decision: RoundDecision) {
  const { choice } = decision;
  if (choice.kind === "other") {
    return choice.text;
  }
  return item.options.find((option) => option.id === choice.optionId)?.target ?? null;
}
