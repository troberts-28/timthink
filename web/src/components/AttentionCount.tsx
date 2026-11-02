export function AttentionCount({ count, className = "" }: { count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span
      className={`grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-on-accent tabular-nums ${className}`}
    >
      {count}
    </span>
  );
}
