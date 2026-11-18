import { type RefObject, useEffect, useRef } from "react";
import { useLocation } from "react-router";

const STORAGE_PREFIX = "timthink:scroll:";
const RESTORE_WINDOW_MS = 4000;
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

function storageKey(location: { pathname: string; search: string }): string {
  return `${STORAGE_PREFIX}${location.pathname}${location.search}`;
}

function readSaved(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(key);
    const top = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(top) && top > 0 ? top : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, top: number): void {
  try {
    sessionStorage.setItem(key, String(Math.round(top)));
  } catch {}
}

export function useScrollRestore(scrollerRef: RefObject<HTMLElement | null>): void {
  const location = useLocation();
  const key = storageKey(location);
  const restoringRef = useRef(false);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onScroll = () => {
      if (!restoringRef.current) writeSaved(key, scroller.scrollTop);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [scrollerRef, key]);

  // Content arrives in stages (doc fetch, review anchors, fonts), so keep re-applying the
  // saved offset until the user takes over or the window closes, not just once on mount.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const initialKey = storageKey(window.location);
    const target = readSaved(initialKey);
    if (!scroller || target === null || window.location.hash) return;

    restoringRef.current = true;
    const deadline = performance.now() + RESTORE_WINDOW_MS;
    let frame = 0;
    const stop = () => {
      restoringRef.current = false;
      cancelAnimationFrame(frame);
      for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, stop, true);
    };
    const tick = () => {
      if (performance.now() > deadline || storageKey(window.location) !== initialKey) return stop();
      if (Math.abs(scroller.scrollTop - target) >= 1) scroller.scrollTop = target;
      frame = requestAnimationFrame(tick);
    };
    for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, stop, { capture: true, passive: true });
    tick();
    return stop;
  }, [scrollerRef]);
}
