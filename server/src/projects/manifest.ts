import { parseDocument, parse as parseYaml } from "yaml";
import { z } from "zod";

export const PROJECT_MANIFEST = "project.yaml";
export const AREA_MANIFEST = "area.yaml";
export const PROJECT_STATUSES = ["active", "paused", "shipped", "dropped"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface PrRef {
  repo: string;
  number: number;
}

export interface ProjectManifest {
  title: string | null;
  summary: string | null;
  status: ProjectStatus;
  repos: string[];
  prs: PrRef[];
  detached: PrRef[];
}

export interface AreaManifest {
  title: string | null;
  summary: string | null;
  repos: string[];
}

export interface ParsedManifest<T> {
  manifest: T;
  problems: string[];
}

export interface ManifestEdit {
  title?: string;
  status?: ProjectStatus;
  prs?: PrRef[];
  detached?: PrRef[];
}

const nameList = z
  .union([z.string(), z.array(z.string())])
  .transform((names) => [...new Set((Array.isArray(names) ? names : [names]).map((name) => name.trim()))])
  .refine((names) => names.every((name) => name !== ""), "names can't be blank");

const prEntries = z
  .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
  .transform((entries) => (Array.isArray(entries) ? entries : [entries]));

const optionalText = z
  .string()
  .nullish()
  .transform((text) => text?.trim() || null);

const projectManifestSchema = z
  .object({
    title: optionalText,
    summary: optionalText,
    status: z.enum(PROJECT_STATUSES).default("active"),
    repos: nameList.default([]),
    prs: prEntries.default([]),
    detached: prEntries.default([]),
  })
  .passthrough();

const areaManifestSchema = z
  .object({ title: optionalText, summary: optionalText, repos: nameList.default([]) })
  .passthrough();

const EMPTY_PROJECT: ProjectManifest = {
  title: null,
  summary: null,
  status: "active",
  repos: [],
  prs: [],
  detached: [],
};

const PR_REF = /^(?:([A-Za-z0-9._-]+)#)?(\d+)$/;
const PR_URL = /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/;
const GRAPHITE_URL = /graphite\.(?:dev|com)\/github\/pr\/[^/]+\/([^/]+)\/(\d+)/;

export function parseProjectManifest(text: string): ParsedManifest<ProjectManifest> {
  const yaml = readYaml(text);
  const parsed = parseLeniently(projectManifestSchema, yaml.value);
  if (!parsed.data) {
    return { manifest: EMPTY_PROJECT, problems: [...yaml.problems, ...parsed.problems] };
  }
  const primaryRepo = parsed.data.repos[0] ?? null;
  const prs = readPrRefs(parsed.data.prs, primaryRepo);
  const detached = readPrRefs(parsed.data.detached, primaryRepo);
  return {
    manifest: {
      title: parsed.data.title,
      summary: parsed.data.summary,
      status: parsed.data.status,
      repos: parsed.data.repos,
      prs: prs.refs,
      detached: detached.refs,
    },
    problems: [...yaml.problems, ...parsed.problems, ...prs.problems, ...detached.problems],
  };
}

export function parseAreaManifest(text: string): ParsedManifest<AreaManifest> {
  const yaml = readYaml(text);
  const parsed = parseLeniently(areaManifestSchema, yaml.value);
  const area = parsed.data ?? { title: null, summary: null, repos: [] };
  return {
    manifest: { title: area.title, summary: area.summary, repos: area.repos },
    problems: [...yaml.problems, ...parsed.problems],
  };
}

export function parsePrRef(entry: string | number, defaultRepo: string | null): PrRef | null {
  const text = String(entry).trim();
  const url = PR_URL.exec(text) ?? GRAPHITE_URL.exec(text);
  if (url?.[1] && url[2]) {
    return { repo: url[1], number: Number(url[2]) };
  }
  const ref = PR_REF.exec(text);
  const repo = ref?.[1] ?? defaultRepo;
  if (!ref?.[2] || !repo) {
    return null;
  }
  return { repo, number: Number(ref[2]) };
}

export function isManifestPath(relPath: string) {
  const fileName = relPath.split("/").at(-1);
  return fileName === PROJECT_MANIFEST || fileName === AREA_MANIFEST;
}

export function formatPrRef(ref: PrRef) {
  return `${ref.repo}#${ref.number}`;
}

export function samePr(a: PrRef, b: PrRef) {
  return a.repo === b.repo && a.number === b.number;
}

export function isProjectStatus(value: string): value is ProjectStatus {
  return PROJECT_STATUSES.some((status) => status === value);
}

export function editProjectManifest(text: string, edit: ManifestEdit) {
  const document = parseDocument(text);
  if (edit.title) {
    document.set("title", edit.title);
  }
  if (edit.status) {
    document.set("status", edit.status);
  }
  if (edit.prs) {
    document.set("prs", edit.prs.map(formatPrRef));
  }
  if (edit.detached && edit.detached.length > 0) {
    document.set("detached", edit.detached.map(formatPrRef));
  }
  if (edit.detached && edit.detached.length === 0) {
    document.delete("detached");
  }
  return document.toString();
}

export function serializeProjectManifest(manifest: ProjectManifest) {
  const lines = [
    `title: ${JSON.stringify(manifest.title ?? "")}`,
    ...(manifest.summary ? [`summary: ${JSON.stringify(manifest.summary)}`] : []),
    `status: ${manifest.status}`,
    `repos: ${yamlList(manifest.repos)}`,
    `prs: ${yamlList(manifest.prs.map(formatPrRef))}`,
  ];
  return `${lines.join("\n")}\n`;
}

function readYaml(text: string): { value: unknown; problems: string[] } {
  try {
    return { value: parseYaml(text), problems: [] };
  } catch (error) {
    const message = error instanceof Error ? (error.message.split("\n")[0] ?? "Invalid YAML") : "Invalid YAML";
    return { value: null, problems: [message] };
  }
}

function parseLeniently<Schema extends z.ZodTypeAny>(schema: Schema, value: unknown) {
  if (value !== null && value !== undefined && !isRecord(value)) {
    return { data: null, problems: ["The manifest should be a mapping of fields"] };
  }
  const fields = value ?? {};
  const strict = schema.safeParse(fields);
  if (strict.success) {
    return { data: strict.data, problems: [] };
  }
  const invalidKeys = new Set(strict.error.issues.map((issue) => String(issue.path[0] ?? "")));
  const validFields = Object.fromEntries(Object.entries(fields).filter(([key]) => !invalidKeys.has(key)));
  const lenient = schema.safeParse(validFields);
  return { data: lenient.success ? lenient.data : null, problems: issueMessages(strict.error) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issueMessages(error: z.ZodError) {
  return error.issues.map((issue) => {
    const field = issue.path.join(".");
    return field ? `\`${field}\`: ${issue.message}` : issue.message;
  });
}

function readPrRefs(entries: ReadonlyArray<string | number>, primaryRepo: string | null) {
  const refs: PrRef[] = [];
  const problems: string[] = [];
  for (const entry of entries) {
    const ref = parsePrRef(entry, primaryRepo);
    if (!ref) {
      problems.push(`${JSON.stringify(entry)} isn't a PR: use 123 (needs a repo in \`repos\`), repo#123 or a PR URL`);
      continue;
    }
    if (!refs.some((known) => samePr(known, ref))) {
      refs.push(ref);
    }
  }
  return { refs, problems };
}

function yamlList(items: readonly string[]) {
  return items.length === 0 ? "[]" : `\n${items.map((item) => `  - ${item}`).join("\n")}`;
}
