export interface StatusStyle {
  label: string;
  chipClass: string;
  dotClass: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  draft: { label: "Draft", chipClass: "chip-neutral", dotClass: "bg-ink-32" },
  review: { label: "Needs review", chipClass: "chip-accent", dotClass: "bg-accent" },
  approved: { label: "Approved", chipClass: "chip-ok-soft", dotClass: "bg-ok" },
  "in-progress": { label: "In progress", chipClass: "chip-info", dotClass: "bg-info" },
  done: { label: "Done", chipClass: "chip-ok", dotClass: "bg-ok" },
  abandoned: { label: "Abandoned", chipClass: "chip-muted", dotClass: "bg-line" },
};

const STATUS_ALIASES: Record<string, string> = {
  "in progress": "in-progress",
  in_progress: "in-progress",
  wip: "in-progress",
  complete: "done",
  completed: "done",
  shipped: "done",
  "needs-review": "review",
  "needs review": "review",
};

export function statusStyle(status: string | null): StatusStyle | null {
  if (!status) return null;
  const key = STATUS_ALIASES[status] ?? status;
  return STATUS_STYLES[key] ?? { label: status, chipClass: "chip-neutral", dotClass: "bg-ink-32" };
}
