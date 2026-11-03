import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AppType, ArchiveAction, ArchiveResponse } from "@timthink/server";
import { hc } from "hono/client";
import { sessionToken } from "./client";
import { queryKeys } from "./queries";

const TOKEN_HEADER = "x-timthink-token";
const client = hc<AppType>("/");

export async function setArchive(path: string, action: ArchiveAction): Promise<ArchiveResponse> {
  const response = await client.api.archive.$post(
    { json: { path, action } },
    { headers: { [TOKEN_HEADER]: await sessionToken() } },
  );
  if (!response.ok) throw new Error(`Couldn't update the archive (${response.status})`);
  return response.json();
}

export function useArchiveAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, action }: { path: string; action: ArchiveAction }) => setArchive(path, action),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.index }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inbox }),
      ]);
    },
  });
}
