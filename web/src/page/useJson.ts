import { useQuery } from "@tanstack/react-query";

const LOCAL_SERVICE_REFRESH_MS = 15_000;

export function useJson(url: string) {
  const query = useQuery({
    queryKey: ["page-json", url],
    queryFn: () => fetchJson(url),
    refetchInterval: LOCAL_SERVICE_REFRESH_MS,
    retry: false,
  });
  return {
    data: query.data ?? null,
    error: query.error ? query.error.message : null,
    loading: query.isLoading,
    refresh: () => void query.refetch(),
  };
}

async function fetchJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  const body: unknown = await response.json();
  return body;
}
