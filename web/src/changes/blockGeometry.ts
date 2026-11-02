export function blockElements(root: Element, start: number, end: number): Element[] {
  const inside = Array.from(root.querySelectorAll("[data-s]")).filter((element) => {
    const elementStart = Number(element.getAttribute("data-s"));
    const elementEnd = Number(element.getAttribute("data-e"));
    return elementStart >= start && elementEnd <= end && elementEnd > elementStart;
  });
  const candidates = new Set(inside);
  return inside.filter((element) => {
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (candidates.has(parent)) return false;
    }
    return true;
  });
}

export interface VerticalSpan {
  top: number;
  bottom: number;
}

export function verticalSpan(elements: readonly Element[], originTop: number): VerticalSpan | null {
  const rects = elements.map((element) => element.getBoundingClientRect()).filter((rect) => rect.height > 0);
  if (rects.length === 0) return null;
  return {
    top: Math.min(...rects.map((rect) => rect.top)) - originTop,
    bottom: Math.max(...rects.map((rect) => rect.bottom)) - originTop,
  };
}
