import path from "node:path";
import {
  type DocSummary,
  DocsStore,
  formatPrRef,
  isProjectStatus,
  PROJECT_STATUSES,
  ProjectError,
  type ProjectRecord,
  ProjectRegistry,
  ProjectService,
  parsePrRef,
  ReadOnlyError,
  type TimthinkConfig,
} from "@timthink/server";

export const PROJECT_USAGE = `Usage: timthink project <command>

Commands:
  list [--repo name]                 List areas and projects, optionally only those touching a repo
  show <id>                          Print a project's overview: folder, repos, docs by kind, PRs, open questions
  create <id> --title "…" [--repos a,b] [--summary "…"]
                                     Create <project> or <area>/<project> (the area is created if missing)
  status <id> [status]               Print or set the status: ${PROJECT_STATUSES.join(", ")}
  link-pr <id> <pr>                  Add a PR (123, repo#123 or a PR URL); 123 means the project's first repo
  unlink-pr <id> <pr>                Detach a PR, including one found through a doc or session
  legacy-docs                        Print every doc outside an area or project as JSON, for a doc-moves round

A project id is <project> for a standalone project, or <area>/<project>.`;

export interface ProjectIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface ProjectFlags {
  title?: string;
  summary?: string;
  repos?: string;
  repo?: string;
}

export interface ProjectCommand {
  config: TimthinkConfig;
  args: readonly string[];
  flags: ProjectFlags;
  io: ProjectIo;
}

export async function runProject({ config, args, flags, io }: ProjectCommand): Promise<number> {
  const [subcommand, id, value] = args;
  const registry = new ProjectRegistry(config.docsRoot);
  await registry.scan();
  const service = new ProjectService({ docsRoot: config.docsRoot, registry, readOnly: config.readOnly });
  try {
    if (subcommand === "list") {
      io.out(listProjects(registry, flags.repo));
      return 0;
    }
    if (subcommand === "legacy-docs") {
      io.out(JSON.stringify(await legacyDocs(config, registry), null, 2));
      return 0;
    }
    if (!id) {
      io.err(PROJECT_USAGE);
      return 1;
    }
    if (subcommand === "create") {
      return await createProject({ service, id, flags, io });
    }
    const record = registry.project(id);
    if (!record) {
      io.err(`There is no project ${id}. Run \`timthink project list\` to see them.`);
      return 1;
    }
    if (subcommand === "show") {
      io.out(await showProject(config, registry, record));
      return 0;
    }
    if (subcommand === "status") {
      return await changeStatus({ service, record, requested: value, io });
    }
    if (subcommand === "link-pr" || subcommand === "unlink-pr") {
      const ref = value ? parsePrRef(value, record.manifest.repos[0] ?? null) : null;
      if (!ref) {
        io.err(
          `Give a PR as 123, repo#123 or a PR URL${record.manifest.repos.length === 0 ? " (with a repo: this project lists none)" : ""}`,
        );
        return 1;
      }
      await (subcommand === "link-pr" ? service.linkPr(id, ref) : service.unlinkPr(id, ref));
      io.out(`${id}: ${subcommand === "link-pr" ? "linked" : "detached"} ${formatPrRef(ref)}`);
      return 0;
    }
  } catch (error) {
    if (error instanceof ProjectError || error instanceof ReadOnlyError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
  io.err(PROJECT_USAGE);
  return 1;
}

async function legacyDocs(config: TimthinkConfig, registry: ProjectRegistry) {
  const store = new DocsStore(config.docsRoot, registry);
  await store.scanAll();
  const legacyFolders = new Set(store.legacyRepoNames());
  return store
    .allDocs()
    .filter((doc) => legacyFolders.has(doc.repo))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((doc) => ({
      path: doc.path,
      title: doc.title,
      kind: doc.kind,
      status: doc.status,
      date: doc.date,
      branch: doc.branch,
      prs: doc.prs,
      linear: doc.linear,
      project: doc.project,
    }));
}

function listProjects(registry: ProjectRegistry, repo: string | undefined) {
  const lines: string[] = [];
  for (const area of registry.areas()) {
    const projects = area.projectIds
      .flatMap((projectId) => registry.project(projectId) ?? [])
      .filter((record) => touchesRepo(record, repo));
    if (projects.length === 0 && repo) {
      continue;
    }
    lines.push(`${area.id}  (area: ${area.manifest.title ?? area.id})`);
    for (const project of projects) {
      lines.push(`  ${projectLine(project)}`);
    }
  }
  for (const project of registry.projects().filter((record) => record.area === null && touchesRepo(record, repo))) {
    lines.push(projectLine(project));
  }
  return lines.length > 0 ? lines.join("\n") : repo ? `No projects touch ${repo}.` : "No projects yet.";
}

function touchesRepo(record: ProjectRecord, repo: string | undefined) {
  return !repo || record.manifest.repos.includes(repo);
}

function projectLine(record: ProjectRecord) {
  const repos = record.manifest.repos.length > 0 ? `  [${record.manifest.repos.join(", ")}]` : "";
  return `${record.id}  ${record.manifest.status}  ${record.manifest.title ?? record.slug}${repos}`;
}

async function showProject(config: TimthinkConfig, registry: ProjectRegistry, record: ProjectRecord) {
  const store = new DocsStore(config.docsRoot, registry);
  await store.scanAll();
  const docs = store.projectDocs(record.id);
  const area = record.area ? registry.area(record.area) : undefined;
  const lines = [
    `# ${record.manifest.title ?? record.slug} (${record.id})`,
    [
      `Status: ${record.manifest.status}`,
      area ? `Area: ${area.manifest.title ?? area.id}` : null,
      `Repos: ${record.manifest.repos.join(", ") || "none listed"}`,
    ]
      .filter((part) => part !== null)
      .join(" · "),
    `Folder: ${path.join(config.docsRoot, record.id)}`,
    ...(record.manifest.summary ? ["", record.manifest.summary] : []),
  ];
  if (record.problems.length > 0) {
    lines.push("", "Problems in project.yaml:", ...record.problems.map((problem) => `- ${problem}`));
  }
  lines.push("", "Docs:", ...(docs.length > 0 ? docs.map(docLine) : ["  none yet"]));
  lines.push("", `PRs: ${projectPrs(record, docs).join(", ") || "none linked"}`);
  const questions = docs.flatMap((doc) =>
    (store.contentOf(doc.path)?.questions ?? []).map(
      (question) => `- ${question.id ?? "(no id)"}: ${question.prompt} (${doc.relPath}:${question.line})`,
    ),
  );
  lines.push("", "Open questions:", ...(questions.length > 0 ? questions : ["  none"]));
  return lines.join("\n");
}

function docLine(doc: DocSummary) {
  const repo = doc.repoOverride ? `  (repo: ${doc.repoOverride})` : "";
  return `  ${doc.kind.padEnd(8)} ${(doc.status ?? "-").padEnd(11)} ${doc.date}  ${doc.relPath}  ${doc.title}${repo}`;
}

function projectPrs(record: ProjectRecord, docs: readonly DocSummary[]) {
  const fromDocs = docs.flatMap((doc) => doc.prs.map((number) => `${doc.codeRepo}#${number}`));
  const explicit = record.manifest.prs.map(formatPrRef);
  const detached = new Set(record.manifest.detached.map(formatPrRef));
  return [...new Set([...explicit, ...fromDocs])].filter((ref) => !detached.has(ref));
}

async function createProject({
  service,
  id,
  flags,
  io,
}: {
  service: ProjectService;
  id: string;
  flags: ProjectFlags;
  io: ProjectIo;
}) {
  if (!flags.title) {
    io.err('Give the project a title: timthink project create <id> --title "…"');
    return 1;
  }
  const repos = (flags.repos ?? "")
    .split(",")
    .map((repo) => repo.trim())
    .filter(Boolean);
  const record = await service.create({ id, title: flags.title, summary: flags.summary ?? null, repos });
  io.out(`Created ${record.id}; write its docs into ${path.join(service.docsRoot, record.id)}`);
  return 0;
}

async function changeStatus({
  service,
  record,
  requested,
  io,
}: {
  service: ProjectService;
  record: ProjectRecord;
  requested: string | undefined;
  io: ProjectIo;
}) {
  if (requested === undefined) {
    io.out(record.manifest.status);
    return 0;
  }
  const status = requested.toLowerCase();
  if (!isProjectStatus(status)) {
    io.err(`"${requested}" isn't a project status. Use one of ${PROJECT_STATUSES.join(", ")}.`);
    return 1;
  }
  await service.setStatus(record.id, status);
  io.out(`${record.id}: ${status}`);
  return 0;
}
