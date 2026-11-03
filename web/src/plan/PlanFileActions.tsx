import { Archive, Check, Copy, FolderOpen, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { revealInFinder } from "../api/client";
import { useToast } from "../lib/toast";
import type { PlanArchive } from "./usePlanArchive";

const COPIED_FEEDBACK_MS = 1500;

function IconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-button border border-line-soft text-ink-64 transition-colors duration-150 hover:border-line hover:text-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function PlanFileActions({ docPath, raw }: { docPath: string; raw: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
    } catch {
      toast("Couldn't copy the plan to the clipboard", "bad");
    }
  };

  const reveal = async () => {
    const revealed = await revealInFinder(docPath).catch(() => false);
    if (!revealed) toast("Couldn't show the plan in Finder", "bad");
  };

  return (
    <>
      <IconButton label={copied ? "Copied" : "Copy markdown"} onClick={() => void copy()}>
        {copied ? (
          <Check className="size-4 text-ok" strokeWidth={2} aria-hidden />
        ) : (
          <Copy className="size-4" strokeWidth={1.75} aria-hidden />
        )}
      </IconButton>
      <IconButton label="Show in Finder" onClick={() => void reveal()}>
        <FolderOpen className="size-4" strokeWidth={1.75} aria-hidden />
      </IconButton>
    </>
  );
}

export function ArchiveButton({ plan }: { plan: PlanArchive }) {
  const label = plan.archived ? "Restore plan" : "Archive plan";
  return (
    <IconButton label={label} disabled={plan.pending} onClick={plan.archived ? plan.restorePlan : plan.archivePlan}>
      {plan.archived ? (
        <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden />
      ) : (
        <Archive className="size-4" strokeWidth={1.75} aria-hidden />
      )}
    </IconButton>
  );
}
