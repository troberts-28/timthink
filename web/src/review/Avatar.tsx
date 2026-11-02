import type { Author } from "@timthink/server";
import { Sparkle } from "lucide-react";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}` : (parts[0]?.slice(0, 1) ?? "?");
  return letters.toUpperCase();
}

export function Avatar({ author, name }: { author: Author; name: string }) {
  if (author === "claude") {
    return (
      <span
        className="grid size-5 flex-none place-items-center rounded-full bg-accent-soft text-accent-ink"
        aria-hidden
      >
        <Sparkle className="size-3" strokeWidth={2.25} />
      </span>
    );
  }
  return (
    <span
      className="grid size-5 flex-none place-items-center rounded-full bg-ink text-[9.5px] font-semibold text-surface"
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
