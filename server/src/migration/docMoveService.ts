import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import { ARCHIVE_FILE, type ArchiveFile, archiveFileSchema, emptyArchiveFile } from "../archive/archiveStore.js";
import { IGNORE_FILE } from "../docs/planFilter.js";
import { isIgnoredName } from "../docs/store.js";
import { parseFrontmatter } from "../frontmatter.js";
import { historyDirFor } from "../history/snapshotStore.js";
import { scanFences } from "../markdown/fences.js";
import { demoSources, linkTargets, relativeTarget } from "../markdown/relativeLinks.js";
import { AREA_MANIFEST, PROJECT_MANIFEST, parsePrRef, serializeProjectManifest } from "../projects/manifest.js";
import type { ProjectRegistry } from "../projects/registry.js";
import { ReadOnlyError } from "../readOnly.js";
import { reviewFileFor } from "../reviews/paths.js";
import { docMoveTarget } from "../rounds/docMoveTarget.js";
import type { DocMoveItem, DocMovesRound, RoundOutcome } from "../rounds/schema.js";
import type { SeenStore } from "../seen/seenStore.js";
import { FileJournal } from "./fileJournal.js";
import type { MovedDocs } from "./movedDocs.js";

export const MIGRATIONS_DIR = "migrations";

export interface DocMoveServiceOptions {
  docsRoot: string;
  stateDir: string;
  registry: ProjectRegistry;
  seen: SeenStore;
  movedDocs: MovedDocs;
  readOnly: boolean;
  onMoved: (moves: ReadonlyMap<string, string>) => Promise<void>;
}

export class DocMoveService {
  constructor(private readonly options: DocMoveServiceOptions) {}

  canUndo(round: Pick<DocMovesRound, "id">) {
    return this.journalFor(round.id).exists();
  }

  async apply(round: DocMovesRound) {
    this.assertWritable();
    const { docsRoot, registry, seen, movedDocs } = this.options;
    await registry.scan();
    const contents = await readMarkdown(docsRoot);
    const plan = await planDocMoves({ round, registry, contents, docsRoot });
    const journal = this.journalFor(round.id);
    const moved = new Map([...plan.docMoves].filter(([from, to]) => from !== to));
    try {
      await writeMoves({ plan, contents, journal, docsRoot });
      await moveDocState({ moves: moved, journal, docsRoot });
      await journal.pruneVacatedDirs(docsRoot);
      await journal.recordWrite(seen.filePath);
      await seen.moveDocs(moved);
      await journal.recordWrite(movedDocs.filePath);
      await movedDocs.record(moved);
    } finally {
      await this.options.onMoved(moved);
    }
    return plan.outcomes;
  }

  async undo(round: Pick<DocMovesRound, "id">) {
    this.assertWritable();
    const movedBefore = this.options.movedDocs.all();
    try {
      await this.journalFor(round.id).undo();
      await this.options.seen.reload();
      await this.options.movedDocs.load();
    } finally {
      const movedAfter = this.options.movedDocs.all();
      const undone = [...movedBefore].filter(([from]) => !movedAfter.has(from));
      await this.options.onMoved(new Map(undone.map(([from, to]) => [to, from])));
    }
  }

  private journalFor(roundId: string) {
    return new FileJournal(path.join(this.options.stateDir, MIGRATIONS_DIR, `${roundId}.jsonl`));
  }

  private assertWritable() {
    if (this.options.readOnly) {
      throw new ReadOnlyError();
    }
  }
}

interface DocMovePlan {
  docMoves: Map<string, string>;
  unitMoves: Map<string, string>;
  manifests: Array<{ relPath: string; contents: string }>;
  repoPins: Map<string, string>;
  ignoreRules: Map<string, string[]>;
  outcomes: Record<string, RoundOutcome>;
}

interface PlanInput {
  round: DocMovesRound;
  registry: ProjectRegistry;
  contents: ReadonlyMap<string, string>;
  docsRoot: string;
}

async function planDocMoves({ round, registry, contents, docsRoot }: PlanInput): Promise<DocMovePlan> {
  const plan: DocMovePlan = {
    docMoves: new Map(),
    unitMoves: new Map(),
    manifests: [],
    repoPins: new Map(),
    ignoreRules: new Map(),
    outcomes: {},
  };
  const claimed = new Set<string>();
  const targets = new Map<string, DocMoveItem[]>();
  for (const item of round.items) {
    const decision = round.decisions[item.id];
    const target = decision ? docMoveTarget(item, decision) : null;
    const problem = await moveProblem({ item, target, registry, contents, claimed, docsRoot });
    if (problem !== null || target === null) {
      plan.outcomes[item.id] = { kind: "skipped", note: problem ?? "Left in place", commit: null };
      continue;
    }
    const to = destinationFor(item.doc, target);
    claimed.add(to);
    plan.docMoves.set(item.doc, to);
    plan.outcomes[item.id] = { kind: "moved", note: to, commit: null };
    targets.set(target, [...(targets.get(target) ?? []), item]);
  }
  for (const [target, items] of targets) {
    const repos = planManifests({ plan, round, registry, target, items });
    for (const item of items) {
      const sourceFolder = item.doc.split("/")[0] ?? "";
      if (repos[0] !== sourceFolder) {
        plan.repoPins.set(item.doc, sourceFolder);
      }
    }
  }
  await planUnitMoves({ plan, contents, docsRoot, claimed, itemDocs: round.items.map((item) => item.doc) });
  return plan;
}

interface MoveProblemInput {
  item: DocMoveItem;
  target: string | null;
  registry: ProjectRegistry;
  contents: ReadonlyMap<string, string>;
  claimed: ReadonlySet<string>;
  docsRoot: string;
}

async function moveProblem({ item, target, registry, contents, claimed, docsRoot }: MoveProblemInput) {
  if (target === null) {
    return null;
  }
  if (!contents.has(item.doc)) {
    return `${item.doc} isn't in the docs folder any more`;
  }
  const currentProject = registry.projectForPath(item.doc);
  if (currentProject) {
    return `Already in ${currentProject.id}`;
  }
  const [top = "", slug] = target.split("/");
  if (slug && registry.project(top)) {
    return `${top} is a project, so it can't hold ${target}`;
  }
  if (!slug && registry.area(top)) {
    return `${top} is an area; pick one of its projects`;
  }
  const to = destinationFor(item.doc, target);
  const isTaken = to !== item.doc && (claimed.has(to) || (await exists(path.join(docsRoot, to))));
  return isTaken ? `${to} is taken` : null;
}

function destinationFor(doc: string, target: string) {
  const [, ...below] = doc.split("/");
  const isNamedForTarget = below.length > 1 && below[0] === target.split("/").at(-1);
  return `${target}/${(isNamedForTarget ? below.slice(1) : below).join("/")}`;
}

interface ManifestPlanInput {
  plan: DocMovePlan;
  round: DocMovesRound;
  registry: ProjectRegistry;
  target: string;
  items: readonly DocMoveItem[];
}

function planManifests({ plan, round, registry, target, items }: ManifestPlanInput) {
  const existing = registry.project(target);
  if (existing) {
    return existing.manifest.repos;
  }
  const [top = "", slug] = target.split("/");
  const plannedArea = plan.manifests.some((manifest) => manifest.relPath === `${top}/${AREA_MANIFEST}`);
  if (slug && !registry.area(top) && !plannedArea) {
    const area = round.areas.find((candidate) => candidate.id === top);
    const lines = [`title: ${JSON.stringify(area?.title ?? top)}`];
    if (area?.summary) {
      lines.push(`summary: ${JSON.stringify(area.summary)}`);
    }
    plan.manifests.push({ relPath: `${top}/${AREA_MANIFEST}`, contents: `${lines.join("\n")}\n` });
  }
  const proposal = round.projects.find((candidate) => candidate.id === target);
  const repos = proposal && proposal.repos.length > 0 ? proposal.repos : foldersByDocCount(items);
  const prs = (proposal?.prs ?? []).flatMap((entry) => parsePrRef(entry, repos[0] ?? null) ?? []);
  plan.manifests.push({
    relPath: `${target}/${PROJECT_MANIFEST}`,
    contents: serializeProjectManifest({
      title: proposal?.title ?? slug ?? top,
      summary: proposal?.summary ?? null,
      status: proposal?.status ?? "active",
      repos,
      prs,
      detached: [],
    }),
  });
  return repos;
}

function foldersByDocCount(items: readonly DocMoveItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const folder = item.doc.split("/")[0] ?? "";
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([folder]) => folder);
}

interface UnitPlanInput {
  plan: DocMovePlan;
  contents: ReadonlyMap<string, string>;
  docsRoot: string;
  claimed: Set<string>;
  itemDocs: readonly string[];
}

async function planUnitMoves({ plan, contents, docsRoot, claimed, itemDocs }: UnitPlanInput) {
  const references = [...contents].flatMap(([relPath, raw]) =>
    resolvedLinks(relPath, raw).map((target) => ({ from: relPath, target })),
  );
  const candidates = new Set<string>();
  for (const { from, target } of references) {
    const to = plan.docMoves.get(from);
    const directory = path.posix.dirname(from);
    const isBesideDoc = directory === "." ? false : target.startsWith(`${directory}/`);
    if (!to || to === from || !isBesideDoc || contents.has(target)) {
      continue;
    }
    const firstSegment = target.slice(directory.length + 1).split("/")[0] ?? "";
    if (firstSegment && !isIgnoredName(firstSegment)) {
      candidates.add(`${directory}/${firstSegment}`);
    }
  }
  for (const unit of [...candidates].sort()) {
    const isInsideUnit = (candidate: string) => candidate === unit || candidate.startsWith(`${unit}/`);
    const referrers = new Set(references.filter(({ target }) => isInsideUnit(target)).map(({ from }) => from));
    const destinations = new Set(
      [...referrers].map((from) => {
        const to = plan.docMoves.get(from);
        return to && to !== from ? path.posix.dirname(to) : null;
      }),
    );
    const [destinationDir] = destinations;
    const holdsItemDoc = itemDocs.some(isInsideUnit);
    const unitStat = await stat(path.join(docsRoot, unit)).catch(() => null);
    if (destinations.size !== 1 || !destinationDir || holdsItemDoc || !unitStat) {
      continue;
    }
    const destination = `${destinationDir}/${path.posix.basename(unit)}`;
    if (claimed.has(destination) || (await exists(path.join(docsRoot, destination)))) {
      continue;
    }
    claimed.add(destination);
    plan.unitMoves.set(unit, destination);
    await planIgnoreRule({ plan, docsRoot, unit, destination, isDirectory: unitStat.isDirectory() });
  }
}

interface IgnoreRuleInput {
  plan: DocMovePlan;
  docsRoot: string;
  unit: string;
  destination: string;
  isDirectory: boolean;
}

async function planIgnoreRule({ plan, docsRoot, unit, destination, isDirectory }: IgnoreRuleInput) {
  const [sourceTop = "", ...sourceRest] = unit.split("/");
  const [destinationTop = "", ...destinationRest] = destination.split("/");
  const rules = await readFile(path.join(docsRoot, sourceTop, IGNORE_FILE), "utf8").catch(() => null);
  const trailing = isDirectory ? "/" : "";
  if (
    rules === null ||
    !ignore()
      .add(rules)
      .ignores(`${sourceRest.join("/")}${trailing}`)
  ) {
    return;
  }
  const rule = `/${destinationRest.join("/")}${trailing}`;
  plan.ignoreRules.set(destinationTop, [...(plan.ignoreRules.get(destinationTop) ?? []), rule]);
}

function resolvedLinks(relPath: string, raw: string) {
  const fences = scanFences(raw);
  return [...linkTargets(raw, fences), ...demoSources(raw, fences)].flatMap(({ target }) => {
    const resolved = resolveLink(relPath, target);
    return resolved === null ? [] : [resolved];
  });
}

function resolveLink(relPath: string, target: string) {
  const relative = relativeTarget(target);
  if (relative === null) {
    return null;
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), relative));
  return resolved.startsWith("../") || resolved === ".." ? null : resolved;
}

function mapPath(plan: DocMovePlan, relPath: string) {
  const movedDoc = plan.docMoves.get(relPath);
  if (movedDoc) {
    return movedDoc;
  }
  for (const [from, to] of plan.unitMoves) {
    if (relPath === from || relPath.startsWith(`${from}/`)) {
      return `${to}${relPath.slice(from.length)}`;
    }
  }
  return relPath;
}

interface WriteMovesInput {
  plan: DocMovePlan;
  contents: ReadonlyMap<string, string>;
  journal: FileJournal;
  docsRoot: string;
}

async function writeMoves({ plan, contents, journal, docsRoot }: WriteMovesInput) {
  const absolute = (relPath: string) => path.join(docsRoot, relPath);
  const rewrites = new Map<string, string>();
  for (const [relPath, raw] of contents) {
    const to = mapPath(plan, relPath);
    const relinked = rewriteLinks({ plan, raw, from: relPath, to });
    const pin = plan.repoPins.get(relPath);
    const rewritten = pin && !parseFrontmatter(relinked).data.repo ? withRepoPin(relinked, pin) : relinked;
    if (rewritten !== raw) {
      rewrites.set(to, rewritten);
    }
  }
  for (const manifest of plan.manifests) {
    await journal.write(absolute(manifest.relPath), manifest.contents);
  }
  for (const [from, to] of plan.unitMoves) {
    await journal.rename(absolute(from), absolute(to));
  }
  for (const [from, to] of plan.docMoves) {
    if (from !== to) {
      await journal.rename(absolute(from), absolute(to));
    }
  }
  for (const [relPath, rewritten] of rewrites) {
    await journal.write(absolute(relPath), rewritten);
  }
  for (const [top, rules] of plan.ignoreRules) {
    const ignoreFile = absolute(`${top}/${IGNORE_FILE}`);
    const existing = await readFile(ignoreFile, "utf8").catch(() => "");
    const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
    await journal.write(ignoreFile, `${existing}${separator}${rules.join("\n")}\n`);
  }
}

interface RewriteInput {
  plan: DocMovePlan;
  raw: string;
  from: string;
  to: string;
}

function rewriteLinks({ plan, raw, from, to }: RewriteInput) {
  const fences = scanFences(raw);
  const links = [...linkTargets(raw, fences), ...demoSources(raw, fences)].sort((a, b) => b.start - a.start);
  const isSameDirectory = path.posix.dirname(from) === path.posix.dirname(to);
  let rewritten = raw;
  for (const link of links) {
    const resolved = resolveLink(from, link.target);
    const mapped = resolved === null ? null : mapPath(plan, resolved);
    if (resolved === null || mapped === null || (mapped === resolved && isSameDirectory)) {
      continue;
    }
    const relocated = path.posix.relative(path.posix.dirname(to), mapped);
    const suffixStart = link.target.search(/[?#]/);
    const suffix = suffixStart === -1 ? "" : link.target.slice(suffixStart);
    const replacement = `${link.target.includes("%") ? encodeURI(relocated) : relocated}${suffix}`;
    if (relocated && replacement !== link.target) {
      rewritten = `${rewritten.slice(0, link.start)}${replacement}${rewritten.slice(link.start + link.target.length)}`;
    }
  }
  return rewritten;
}

const FRONTMATTER_OPENING = /^---[ \t]*\r?\n/;
const FRONTMATTER_BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function withRepoPin(raw: string, repo: string) {
  const block = FRONTMATTER_BLOCK.exec(raw);
  const opening = FRONTMATTER_OPENING.exec(raw);
  if (!block || !opening) {
    return `---\nrepo: ${repo}\n---\n\n${raw}`;
  }
  const yamlEnd = opening[0].length + (block[1] ?? "").length;
  return `${raw.slice(0, yamlEnd)}\nrepo: ${repo}${raw.slice(yamlEnd)}`;
}

interface DocStateInput {
  moves: ReadonlyMap<string, string>;
  journal: FileJournal;
  docsRoot: string;
}

async function moveDocState({ moves, journal, docsRoot }: DocStateInput) {
  const absolute = (relPath: string) => path.join(docsRoot, relPath);
  const archives = new Map<string, ArchiveFile>();
  const archiveFor = async (top: string) => {
    const known = archives.get(top);
    if (known) {
      return known;
    }
    const text = await readFile(absolute(`${top}/${ARCHIVE_FILE}`), "utf8").catch(() => null);
    const parsed = text === null ? null : archiveFileSchema.safeParse(parseJson(text));
    const file = parsed?.success ? parsed.data : emptyArchiveFile();
    archives.set(top, file);
    return file;
  };
  const changedArchives = new Set<string>();
  for (const [from, to] of moves) {
    const reviewFrom = reviewFileFor(from);
    const reviewTo = reviewFileFor(to);
    const reviewText = reviewFrom ? await readFile(absolute(reviewFrom), "utf8").catch(() => null) : null;
    if (reviewFrom && reviewTo && reviewText !== null) {
      await journal.rename(absolute(reviewFrom), absolute(reviewTo));
      await journal.write(absolute(reviewTo), `${JSON.stringify({ ...parseRecord(reviewText), doc: to }, null, 2)}\n`);
    }
    const historyFrom = historyDirFor(from);
    const historyTo = historyDirFor(to);
    if (historyFrom && historyTo && (await exists(absolute(historyFrom)))) {
      await journal.rename(absolute(historyFrom), absolute(historyTo));
    }
    const [fromTop = "", ...fromRest] = from.split("/");
    const [toTop = "", ...toRest] = to.split("/");
    const source = await archiveFor(fromTop);
    const destination = await archiveFor(toTop);
    for (const key of ["archived", "keepActive"] as const) {
      const at = source[key][fromRest.join("/")];
      if (at) {
        delete source[key][fromRest.join("/")];
        destination[key][toRest.join("/")] = at;
        changedArchives.add(fromTop);
        changedArchives.add(toTop);
      }
    }
  }
  for (const top of changedArchives) {
    const file = await archiveFor(top);
    const next = { ...file, version: file.version + 1 };
    await journal.write(absolute(`${top}/${ARCHIVE_FILE}`), `${JSON.stringify(next, null, 2)}\n`);
  }
}

async function readMarkdown(docsRoot: string) {
  const contents = new Map<string, string>();
  const walk = async (relDir: string) => {
    const entries = await readdir(path.join(docsRoot, relDir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (isIgnoredName(entry.name) || entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(relPath);
      } else if (relDir && entry.name.toLowerCase().endsWith(".md")) {
        contents.set(relPath, await readFile(path.join(docsRoot, relPath), "utf8"));
      }
    }
  };
  await walk("");
  return contents;
}

async function exists(absolute: string) {
  return (await stat(absolute).catch(() => null)) !== null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseRecord(text: string): Record<string, unknown> {
  const value = parseJson(text);
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
}
