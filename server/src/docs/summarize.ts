import path from "node:path";
import { type FrontmatterData, frontmatterList, frontmatterString, parseFrontmatter } from "../frontmatter.js";
import { DOC_KINDS, type DocKind, type DocSummary, type TaskProgress } from "./types.js";

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:[-_ ]|$)/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const ATX_H1 = /^\s{0,3}#\s+(.+?)\s*#*\s*$/;
const TASK_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s/;

export interface DocLocation {
  path: string;
  repo: string;
  relPath: string;
  folderProject: string | null;
}

export function locateDoc(docPath: string): DocLocation | null {
  const segments = docPath.split("/");
  const [repo, ...rest] = segments;
  if (!repo || rest.length === 0) return null;
  return {
    path: docPath,
    repo,
    relPath: rest.join("/"),
    folderProject: rest.length > 1 ? (rest[0] ?? null) : null,
  };
}

export function* linesOutsideFences(body: string): Generator<string> {
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence === null) yield line;
  }
}

export function firstHeading(body: string): string | null {
  for (const line of linesOutsideFences(body)) {
    const match = ATX_H1.exec(line);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function countTasks(body: string): TaskProgress {
  let done = 0;
  let total = 0;
  for (const line of linesOutsideFences(body)) {
    const match = TASK_ITEM.exec(line);
    if (!match) continue;
    total += 1;
    if (match[1] !== " ") done += 1;
  }
  return { done, total };
}

export function titleFromFilename(fileName: string): string {
  const stem = fileName.replace(/\.md$/i, "").replace(DATE_PREFIX, "");
  const words = stem.replace(/[-_]+/g, " ").trim();
  if (!words) return fileName;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function normaliseDate(value: string | null): string | null {
  if (!value) return null;
  if (ISO_DATE.test(value)) return value.slice(0, 10);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function resolveDate(data: FrontmatterData, fileName: string, mtime: number): string {
  return (
    normaliseDate(frontmatterString(data, "date")) ??
    DATE_PREFIX.exec(fileName)?.[1] ??
    new Date(mtime).toISOString().slice(0, 10)
  );
}

const PR_NUMBER = /^#?(\d+)$/;
const PR_URL = /\/(?:pull|pr\/[^/]+\/[^/]+)\/(\d+)\/?$/;

function prNumber(value: string): string | null {
  return PR_NUMBER.exec(value.trim())?.[1] ?? PR_URL.exec(value.trim())?.[1] ?? null;
}

const KIND_BY_FILENAME: ReadonlyArray<[RegExp, DocKind]> = [
  [/\b(research|investigation|spike|eval|audit|analysis)\b/, "research"],
  [/\b(design|architecture|spec|brief)\b/, "design"],
  [/\b(handoff|handover)\b/, "handoff"],
  [/\b(decision|adr)\b/, "decision"],
  [/\b(notes|log|changelog|checklist|demos?)\b/, "notes"],
];

function isDocKind(value: string): value is DocKind {
  return (DOC_KINDS as readonly string[]).includes(value);
}

export function inferKind(declared: string | null, fileName: string): DocKind {
  const normalised = declared?.toLowerCase() ?? null;
  if (normalised && isDocKind(normalised)) return normalised;
  const words = fileName.toLowerCase().replace(/\.md$/, "").replace(/[-_]+/g, " ");
  return KIND_BY_FILENAME.find(([pattern]) => pattern.test(words))?.[1] ?? "plan";
}

export interface SummarizeInput {
  path: string;
  raw: string;
  mtime: number;
}

export function summarizeDoc({ path: docPath, raw, mtime }: SummarizeInput): DocSummary | null {
  const location = locateDoc(docPath);
  if (!location) return null;
  const { data, body, error } = parseFrontmatter(raw);
  const fileName = path.posix.basename(docPath);
  const declaredProject = frontmatterString(data, "project");
  const repoOverride = frontmatterString(data, "repo");
  return {
    path: docPath,
    repo: location.repo,
    project: declaredProject && declaredProject !== location.repo ? declaredProject : location.folderProject,
    projectId: null,
    codeRepo: repoOverride ?? location.repo,
    repoOverride,
    kind: inferKind(frontmatterString(data, "kind"), fileName),
    relPath: location.relPath,
    title: frontmatterString(data, "title") ?? firstHeading(body) ?? titleFromFilename(fileName),
    date: resolveDate(data, fileName, mtime),
    mtime,
    status: frontmatterString(data, "status")?.toLowerCase() ?? null,
    branch: frontmatterString(data, "branch"),
    prs: frontmatterList(data, "pr").flatMap((value) => prNumber(value) ?? []),
    linear: frontmatterString(data, "linear"),
    tasks: countTasks(body),
    frontmatterError: error,
  };
}
