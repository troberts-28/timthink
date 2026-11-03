import { useCallback, useSyncExternalStore } from "react";

const listeners = new Map<string, Set<() => void>>();

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
  for (const listener of listeners.get(key) ?? []) listener();
}

function subscribe(key: string, listener: () => void): () => void {
  const forKey = listeners.get(key) ?? new Set();
  forKey.add(listener);
  listeners.set(key, forKey);
  return () => forKey.delete(listener);
}

export function useLocalString(key: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(key, listener), [key]),
    () => readLocal(key),
  );
  const set = useCallback((next: string | null) => writeLocal(key, next), [key]);
  return [value, set];
}

export function useLocalFlag(key: string): [boolean, (value: boolean) => void] {
  const [raw, setRaw] = useLocalString(key);
  const set = useCallback((value: boolean) => setRaw(value ? "1" : null), [setRaw]);
  return [raw === "1", set];
}

function parseNames(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function useLocalNameSet(key: string): [ReadonlySet<string>, (name: string, included: boolean) => void] {
  const [raw, setRaw] = useLocalString(key);
  const names = parseNames(raw);
  const toggle = useCallback(
    (name: string, included: boolean) => {
      const next = new Set(parseNames(readLocal(key)));
      if (included) next.add(name);
      else next.delete(name);
      setRaw(next.size > 0 ? JSON.stringify([...next]) : null);
    },
    [key, setRaw],
  );
  return [new Set(names), toggle];
}
