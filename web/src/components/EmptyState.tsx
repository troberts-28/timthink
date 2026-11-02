import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, children }: { icon?: LucideIcon; children: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center text-ui text-ink-64">
      {Icon ? <Icon className="size-5 text-ink-32" strokeWidth={1.5} aria-hidden /> : null}
      <p className="m-0">{children}</p>
    </div>
  );
}
