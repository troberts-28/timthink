import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { setRepoHidden } from "../api/client";
import { queryKeys } from "../api/queries";
import { useToast } from "./toast";

export function useRepoVisibility(): (repo: string, hidden: boolean) => void {
  const queryClient = useQueryClient();
  const toast = useToast();
  const apply = useCallback(
    async (repo: string, hidden: boolean): Promise<boolean> => {
      const ok = await setRepoHidden(repo, hidden).catch(() => false);
      if (ok) await queryClient.invalidateQueries({ queryKey: queryKeys.index });
      return ok;
    },
    [queryClient],
  );
  return useCallback(
    (repo: string, hidden: boolean) => {
      void apply(repo, hidden).then((ok) => {
        if (!ok) {
          toast(`Couldn't ${hidden ? "hide" : "show"} ${repo}`, "bad");
          return;
        }
        if (!hidden) return;
        toast(
          <span className="flex items-center gap-3">
            Hid {repo}
            <button
              type="button"
              className="font-semibold text-ink underline decoration-line underline-offset-3 hover:decoration-ink"
              onClick={() => void apply(repo, false)}
            >
              Undo
            </button>
          </span>,
        );
      });
    },
    [apply, toast],
  );
}
