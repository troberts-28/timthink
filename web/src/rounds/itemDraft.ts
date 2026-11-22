import type { RoundDecision, RoundItem } from "@timthink/server";

export type Selection = { kind: "option"; optionId: string } | { kind: "other" } | null;

export interface ItemDraft {
  selection: Selection;
  otherText: string;
  reply: string;
}

export function draftFromDecision(decision: RoundDecision | undefined): ItemDraft {
  if (!decision) {
    return { selection: null, otherText: "", reply: "" };
  }
  const { choice, reply } = decision;
  return choice.kind === "option"
    ? { selection: { kind: "option", optionId: choice.optionId }, otherText: "", reply }
    : { selection: { kind: "other" }, otherText: choice.text, reply };
}

export function decisionFromDraft(draft: ItemDraft): RoundDecision | null {
  const { selection, otherText, reply } = draft;
  if (selection?.kind === "option") {
    return { choice: { kind: "option", optionId: selection.optionId }, reply };
  }
  if (selection?.kind === "other" && otherText.trim()) {
    return { choice: { kind: "other", text: otherText.trim() }, reply };
  }
  return null;
}

export function withOption(item: RoundItem, draft: ItemDraft, optionId: string): ItemDraft {
  const drafted = "reply" in item && item.reply.kind === "drafted" ? item.reply.drafts : null;
  return {
    ...draft,
    selection: { kind: "option", optionId },
    reply: drafted ? (drafted[optionId] ?? "") : draft.reply,
  };
}

export function withOther(item: RoundItem, draft: ItemDraft): ItemDraft {
  const isDrafted = "reply" in item && item.reply.kind === "drafted";
  return { ...draft, selection: { kind: "other" }, reply: isDrafted ? "" : draft.reply };
}
