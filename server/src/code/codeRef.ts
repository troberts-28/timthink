export interface CodeRef {
  path: string;
  line: number | null;
  col: number | null;
}

const LOCATION_SUFFIX = /^(.*?)(?::(\d+))?(?::(\d+))?$/;

export function parseCodeRef(ref: string): CodeRef {
  const trimmed = ref.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  const match = LOCATION_SUFFIX.exec(trimmed);
  const filePath = match?.[1] ?? trimmed;
  return {
    path: filePath,
    line: match?.[2] ? Number.parseInt(match[2], 10) : null,
    col: match?.[3] ? Number.parseInt(match[3], 10) : null,
  };
}
