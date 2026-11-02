export interface CardSlot {
  id: string;
  desiredTop: number;
  height: number;
}

export const CARD_GAP = 10;

// Cards want to sit level with their highlight; the active card wins its spot and the rest stack away from it.
export function layoutCards(
  slots: readonly CardSlot[],
  activeId: string | null,
  minTop = 0,
  gap = CARD_GAP,
): Map<string, number> {
  const ordered = [...slots].sort((a, b) => a.desiredTop - b.desiredTop || a.id.localeCompare(b.id));
  const tops = new Map<string, number>();
  const pivot = Math.max(
    0,
    ordered.findIndex((slot) => slot.id === activeId),
  );
  const pivotSlot = ordered[pivot];
  if (!pivotSlot) return tops;
  const hasActive = ordered.some((slot) => slot.id === activeId);
  let cursor = minTop;
  if (!hasActive) {
    for (const slot of ordered) {
      const top = Math.max(slot.desiredTop, cursor);
      tops.set(slot.id, top);
      cursor = top + slot.height + gap;
    }
    return tops;
  }
  const pivotTop = Math.max(pivotSlot.desiredTop, minTop);
  tops.set(pivotSlot.id, pivotTop);
  cursor = pivotTop + pivotSlot.height + gap;
  for (const slot of ordered.slice(pivot + 1)) {
    const top = Math.max(slot.desiredTop, cursor);
    tops.set(slot.id, top);
    cursor = top + slot.height + gap;
  }
  let ceiling = pivotTop - gap;
  for (const slot of ordered.slice(0, pivot).reverse()) {
    const top = Math.min(slot.desiredTop, ceiling - slot.height);
    tops.set(slot.id, top);
    ceiling = top - gap;
  }
  const overflow = minTop - Math.min(...tops.values());
  if (overflow > 0) {
    let push = minTop;
    for (const slot of ordered) {
      const top = Math.max(tops.get(slot.id) ?? 0, push);
      tops.set(slot.id, top);
      push = top + slot.height + gap;
    }
  }
  return tops;
}
