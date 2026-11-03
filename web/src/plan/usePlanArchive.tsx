import type { DocArchive } from "@timthink/server";
import { useCallback } from "react";
import { useArchiveAction } from "../api/archive";
import { useDocsIndex } from "../api/queries";
import { archiveOf, isArchived } from "../lib/archive";
import { findDoc } from "../lib/indexNav";
import { useToast } from "../lib/toast";

export interface PlanArchive {
  archive: DocArchive;
  archived: boolean;
  pending: boolean;
  archivePlan: () => void;
  restorePlan: () => void;
}

export function usePlanArchive(docPath: string): PlanArchive {
  const { data: index } = useDocsIndex();
  const mutation = useArchiveAction();
  const toast = useToast();
  const doc = findDoc(index, docPath);
  const archive = doc ? archiveOf(doc) : { state: "active" as const };
  const { mutate } = mutation;

  const restorePlan = useCallback(() => {
    mutate(
      { path: docPath, action: "keep-active" },
      {
        onSuccess: () => toast("Restored. This plan stays active until you archive it."),
        onError: () => toast("Couldn't restore the plan", "bad"),
      },
    );
  }, [docPath, mutate, toast]);

  const archivePlan = useCallback(() => {
    mutate(
      { path: docPath, action: "archive" },
      {
        onSuccess: () =>
          toast(
            <span className="flex items-center gap-3">
              Archived
              <button
                type="button"
                className="font-semibold text-ink underline decoration-line underline-offset-3 hover:decoration-ink"
                onClick={() => mutate({ path: docPath, action: "clear" })}
              >
                Undo
              </button>
            </span>,
          ),
        onError: () => toast("Couldn't archive the plan", "bad"),
      },
    );
  }, [docPath, mutate, toast]);

  return { archive, archived: doc ? isArchived(doc) : false, pending: mutation.isPending, archivePlan, restorePlan };
}
