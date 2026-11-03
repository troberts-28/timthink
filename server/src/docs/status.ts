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
  pending: "draft",
  todo: "draft",
  "not started": "draft",
  planned: "draft",
  "on staging": "in-progress",
  implemented: "in-progress",
  building: "in-progress",
  merged: "done",
  finished: "done",
  cancelled: "abandoned",
  canceled: "abandoned",
  dropped: "abandoned",
  superseded: "abandoned",
};

export function canonicalStatus(status: string | null): string | null {
  if (!status) return null;
  const lower = status.trim().toLowerCase();
  return STATUS_ALIASES[lower] ?? lower;
}
