const STATUS_ALIASES: Readonly<Record<string, string>> = {
  "in progress": "in-progress",
  in_progress: "in-progress",
  wip: "in-progress",
  active: "in-progress",
  complete: "done",
  completed: "done",
  shipped: "done",
  "needs-review": "review",
  "needs review": "review",
};

export function canonicalStatus(status: string | null): string | null {
  if (!status) return null;
  const lower = status.trim().toLowerCase();
  return STATUS_ALIASES[lower] ?? lower;
}
