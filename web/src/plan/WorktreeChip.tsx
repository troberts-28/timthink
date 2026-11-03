import { useQuery } from "@tanstack/react-query";
import { FolderGit2, SquareTerminal } from "lucide-react";
import { fetchDocWorktree, openWorktree } from "../api/prs";
import { useToast } from "../lib/toast";

const WORKTREE_STALE_MS = 30_000;

export function WorktreeChip({ docPath, branch }: { docPath: string; branch: string | null }) {
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ["doc-worktree", docPath, branch],
    queryFn: () => fetchDocWorktree(docPath),
    staleTime: WORKTREE_STALE_MS,
    enabled: branch !== null,
  });
  const worktree = data?.worktree;
  if (!worktree) return null;
  const open = (app: "zed" | "warp") => {
    openWorktree(docPath, app).then(
      (result) => {
        if (result.status !== "opened") toast(result.message ?? "Couldn't open the worktree", "bad");
      },
      () => toast("Couldn't open the worktree", "bad"),
    );
  };
  return (
    <span
      className="chip chip-neutral gap-1 pr-0.5 font-mono text-[11.5px]"
      title={`${branch} is checked out in ${worktree.path}`}
    >
      <FolderGit2 className="size-3" aria-hidden />
      {worktree.name}
      <button
        type="button"
        onClick={() => open("zed")}
        className="ml-0.5 rounded px-1 font-sans text-[11px] text-ink-64 hover:bg-bg-sunken hover:text-ink"
        title={`Open ${worktree.name} in Zed`}
      >
        Zed
      </button>
      <button
        type="button"
        onClick={() => open("warp")}
        aria-label={`Open ${worktree.name} in a Warp tab`}
        title={`Open ${worktree.name} in a Warp tab`}
        className="grid size-5 place-items-center rounded text-ink-64 hover:bg-bg-sunken hover:text-ink"
      >
        <SquareTerminal className="size-3" aria-hidden />
      </button>
    </span>
  );
}
