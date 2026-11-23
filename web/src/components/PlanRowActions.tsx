import type { DocSummary } from "@timthink/server";
import { Archive, PencilLine, RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { renameDoc } from "../api/projects";
import { usePlanArchive } from "../plan/usePlanArchive";
import { RenameDialog } from "./RenameDialog";

export function PlanRowActions({ doc }: { doc: DocSummary }) {
  const plan = usePlanArchive(doc.path);
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <IconAction label="Rename plan" onClick={() => setRenaming(true)}>
        <PencilLine className="size-3.5" strokeWidth={1.75} aria-hidden />
      </IconAction>
      <IconAction
        label={plan.archived ? "Restore plan" : "Archive plan"}
        disabled={plan.pending}
        onClick={plan.archived ? plan.restorePlan : plan.archivePlan}
      >
        {plan.archived ? (
          <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden />
        ) : (
          <Archive className="size-3.5" strokeWidth={1.75} aria-hidden />
        )}
      </IconAction>
      {renaming ? (
        <RenameDialog
          heading="Rename this plan"
          currentTitle={doc.title}
          hint="Sets the title in the plan's frontmatter. The file name and its links stay the same."
          rename={(title) => renameDoc(doc.path, title)}
          onClose={() => setRenaming(false)}
        />
      ) : null}
    </>
  );
}

function IconAction({
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
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-[6px] text-ink-64 hover:bg-bg-sunken hover:text-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}
