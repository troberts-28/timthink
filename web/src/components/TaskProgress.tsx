import type { TaskProgress as Progress } from "@timthink/server";

export function ProgressBar({ tasks, className = "" }: { tasks: Progress; className?: string }) {
  const percent = tasks.total === 0 ? 0 : Math.round((tasks.done / tasks.total) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={tasks.total}
      aria-valuenow={tasks.done}
      aria-label={`${tasks.done} of ${tasks.total} tasks done`}
      className={`h-1 overflow-hidden rounded-full bg-line-soft ${className}`}
    >
      <div
        className="h-full rounded-full bg-ok transition-[width] duration-250 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function TaskCount({ tasks }: { tasks: Progress }) {
  if (tasks.total === 0) return null;
  return (
    <span className="flex items-center gap-2 text-meta text-ink-64 tabular-nums">
      <ProgressBar tasks={tasks} className="w-12" />
      {tasks.done}/{tasks.total}
    </span>
  );
}
