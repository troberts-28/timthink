const DAY_MS = 24 * 60 * 60 * 1000;

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });
const LONG_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function parseIsoDate(isoDate: string): Date {
  const [year = 1970, month = 1, day = 1] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function compactDate(isoDate: string, now: Date = new Date()): string {
  const date = parseIsoDate(isoDate);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  if (days < 7) return `${days}d`;
  if (date.getFullYear() === now.getFullYear()) return SHORT_DATE.format(date);
  return MONTH_YEAR.format(date);
}

export function longDate(isoDate: string): string {
  return LONG_DATE.format(parseIsoDate(isoDate));
}

export function relativeTime(epochMs: number, now: number = Date.now()): string {
  const minutes = Math.round((now - epochMs) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return LONG_DATE.format(new Date(epochMs));
}

const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

export function fileSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${SIZE_UNITS[unit]}`;
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
