export interface BuildRequest {
  doc: string;
  phase?: number | null;
  branch?: string | null;
}

const BRANCH_NAME = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._/-]+(?<![./])$/;
const BRANCH_MAX_LENGTH = 120;
const SLUG_MAX_LENGTH = 48;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}[-_ ]?/;
const TIMTHINK_COMMAND = /<command-name>\/timthink<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const SLASH_BUILD = /^\/timthink\s+build\s+(.+)$/;

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function isValidBranchName(branch: string): boolean {
  return branch.length <= BRANCH_MAX_LENGTH && BRANCH_NAME.test(branch) && !branch.endsWith(".lock");
}

export function isValidPhase(phase: number): boolean {
  return Number.isInteger(phase) && phase >= 0 && phase < 1000;
}

function quoteArgument(value: string): string {
  return /^[\w./~@:+-]+$/.test(value) ? value : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function buildSlashCommand({ doc, phase, branch }: BuildRequest): string {
  const parts = ["/timthink", "build", quoteArgument(doc)];
  if (phase !== null && phase !== undefined) parts.push("--phase", String(phase));
  if (branch) parts.push("--branch", branch);
  return parts.join(" ");
}

export function buildShellCommand(request: BuildRequest, cwd: string | null): string {
  const claude = `claude ${shellQuote(buildSlashCommand(request))}`;
  return cwd ? `cd ${shellQuote(cwd)} && ${claude}` : claude;
}

export function suggestBranch(docPath: string): string {
  const fileName = docPath.split("/").pop() ?? docPath;
  const slug = fileName
    .replace(/\.md$/i, "")
    .replace(DATE_PREFIX, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
  return `feat/${slug || "plan"}`;
}

function tokenize(args: string): string[] {
  const tokens: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (const match of args.matchAll(pattern)) {
    const [, doubleQuoted, singleQuoted, bare] = match;
    if (doubleQuoted !== undefined) tokens.push(doubleQuoted.replace(/\\(.)/g, "$1"));
    else tokens.push(singleQuoted ?? bare ?? "");
  }
  return tokens;
}

export function parseBuildArgs(args: string): BuildRequest | null {
  const [verb, ...rest] = tokenize(args.trim());
  if (verb !== "build") return null;
  let doc: string | null = null;
  let phase: number | null = null;
  let branch: string | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] ?? "";
    if (token === "--phase") {
      const value = Number(rest[index + 1]);
      if (isValidPhase(value)) phase = value;
      index += 1;
    } else if (token === "--branch") {
      const value = rest[index + 1] ?? "";
      if (isValidBranchName(value)) branch = value;
      index += 1;
    } else if (doc === null && !token.startsWith("--")) {
      doc = token;
    }
  }
  return doc ? { doc, phase, branch } : null;
}

export function buildRequestInPrompt(content: string): BuildRequest | null {
  if (TIMTHINK_COMMAND.test(content)) {
    const args = COMMAND_ARGS.exec(content)?.[1];
    return args === undefined ? null : parseBuildArgs(args);
  }
  const typed = SLASH_BUILD.exec(content.trim().split("\n", 1)[0] ?? "");
  return typed?.[1] ? parseBuildArgs(`build ${typed[1]}`) : null;
}
