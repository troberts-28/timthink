import { useEffect, useState } from "react";
import type { TocEntry } from "../markdown/rehypePlugins";

const ACTIVATION_OFFSET_PX = 96;

export function useActiveHeading(toc: readonly TocEntry[], scrollContainerId: string): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const container = document.getElementById(scrollContainerId);
    if (!container || toc.length === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = container.getBoundingClientRect().top + ACTIVATION_OFFSET_PX;
      let current: string | null = toc[0]?.id ?? null;
      for (const entry of toc) {
        const element = document.getElementById(entry.id);
        if (element && element.getBoundingClientRect().top <= top) current = entry.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [toc, scrollContainerId]);
  return active;
}
