import { statusStyle } from "../lib/status";

export function StatusChip({ status }: { status: string | null }) {
  const style = statusStyle(status);
  if (!style) return null;
  return <span className={`chip ${style.chipClass}`}>{style.label}</span>;
}

export function StatusDot({ status, className = "" }: { status: string | null; className?: string }) {
  const style = statusStyle(status);
  const label = style?.label ?? "No status";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block size-2 flex-none rounded-full ${style ? style.dotClass : "border border-ink-32"} ${className}`}
    />
  );
}
