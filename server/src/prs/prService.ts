import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrSettings } from "../config.js";
import type { DocSummary, GithubRepo, PrAttention } from "../docs/types.js";
import type { SessionRecord } from "../sessions/sessionStore.js";
import type { SubmittedPr } from "../sessions/types.js";
import { GhUnavailableError, type GraphqlRunner } from "./ghClient.js";
import { buildRepoQuery, landedOnTrunk, type MergeCheck, parseRepoQuery, type RepoQuery, toPrInfo } from "./graphql.js";
import {
  type DocPrsResponse,
  isTerminal,
  type LinkedPr,
  type PrInfo,
  type PrLookupResponse,
  type PrSource,
  prKey,
  type StackItem,
} from "./types.js";

export const PRS_STATE_FILE = "prs.json";
const STATE_VERSION = 1;
const ACTIVE_INTERVAL_MS = 2 * 60_000;
const IDLE_INTERVAL_MS = 15 * 60_000;
const TICK_MS = 30_000;
const DOC_STALE_MS = 2 * 60_000;
const LOOKUP_STALE_MS = 10 * 60_000;
const MAX_ROUNDS = 4;
const PRS_PER_QUERY = 8;
const REFS_PER_QUERY = 8;
const MAX_STACK = 30;

interface CachedPr {
  info: PrInfo;
  fetchedAt: string;
  trunkChecked: boolean;
}

interface StateFile {
  version: number;
  trunks: Record<string, string>;
  refreshedAt: Record<string, string>;
  prs: Record<string, CachedPr>;
  stacks: Record<string, number[]>;
  unlinked: Record<string, number[]>;
  completed: Record<string, string>;
}

function emptyState(): StateFile {
  return { version: STATE_VERSION, trunks: {}, refreshedAt: {}, prs: {}, stacks: {}, unlinked: {}, completed: {} };
}

export interface PrServiceOptions {
  settings: PrSettings;
  stateDir: string;
  docs: { getDoc(docPath: string): DocSummary | undefined; allDocs(): DocSummary[] };
  sessions: { all(): SessionRecord[] };
  githubFor: (repo: string) => GithubRepo | null;
  isArchived: (doc: DocSummary) => boolean;
  runner: GraphqlRunner;
  onChange: (docPaths: string[]) => void;
  onPrsSettled?: (docPaths: string[]) => void;
  hasViewers: () => boolean;
  log?: (message: string) => void;
  now?: () => number;
}

function repoKey(github: GithubRepo): string {
  return `${github.owner.toLowerCase()}/${github.repo.toLowerCase()}`;
}

function sameRepo(pr: SubmittedPr, github: GithubRepo): boolean {
  return pr.owner.toLowerCase() === github.owner.toLowerCase() && pr.repo.toLowerCase() === github.repo.toLowerCase();
}

export class PrService {
  private state: StateFile = emptyState();
  private sessionIndex: Map<string, SubmittedPr[]> | null = null;
  private running: Promise<void> | null = null;
  private queued: { docPaths: Set<string> | null; extra: Map<string, Set<number>> } | null = null;
  private lastError: { kind: "unavailable" | "error"; message: string } | null = null;
  private lastFullRefresh = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(private readonly options: PrServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  private get statePath(): string {
    return path.join(this.options.stateDir, PRS_STATE_FILE);
  }

  async init(): Promise<void> {
    const text = await readFile(this.statePath, "utf8").catch(() => null);
    if (!text) return;
    try {
      const parsed = JSON.parse(text) as StateFile;
      if (parsed.version === STATE_VERSION) this.state = { ...emptyState(), ...parsed };
    } catch {}
  }

  invalidateSessions(): void {
    this.sessionIndex = null;
  }

  start(): () => void {
    if (!this.options.settings.enabled) return () => {};
    const tick = (): void => {
      const interval = this.options.hasViewers() ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
      if (this.now() - this.lastFullRefresh >= interval) void this.refresh();
    };
    tick();
    this.timer = setInterval(tick, TICK_MS);
    this.timer.unref();
    return () => {
      if (this.timer) clearInterval(this.timer);
    };
  }

  linkedNumbers(doc: DocSummary): Map<number, PrSource[]> {
    const github = this.options.githubFor(doc.repo);
    const linked = new Map<number, PrSource[]>();
    const add = (number: number, source: PrSource) => {
      const sources = linked.get(number) ?? [];
      if (!sources.includes(source)) sources.push(source);
      linked.set(number, sources);
    };
    for (const pr of doc.prs) add(Number(pr), "frontmatter");
    if (github) {
      for (const pr of this.sessionPrs().get(doc.path) ?? []) if (sameRepo(pr, github)) add(pr.number, "session");
    }
    for (const number of this.state.unlinked[doc.path] ?? []) linked.delete(number);
    return linked;
  }

  docPrs(docPath: string): DocPrsResponse {
    const doc = this.options.docs.getDoc(docPath);
    const github = doc ? this.options.githubFor(doc.repo) : null;
    const base = {
      github: github ? { owner: github.owner, repo: github.repo } : null,
      trunk: github ? (this.state.trunks[repoKey(github)] ?? null) : null,
      asOf: github ? (this.state.refreshedAt[repoKey(github)] ?? null) : null,
      refreshing: this.running !== null,
      unlinked: this.state.unlinked[docPath] ?? [],
    };
    if (!this.options.settings.enabled) {
      return { ...base, status: "disabled", message: null, linked: [], stack: [] };
    }
    if (!doc || !github) {
      return { ...base, status: "no-github", message: null, linked: [], stack: [] };
    }
    const linkedMap = this.linkedNumbers(doc);
    const linked: LinkedPr[] = [...linkedMap].map(([number, sources]) => ({
      number,
      sources,
      info: this.cached(github, number)?.info ?? null,
    }));
    const stack: StackItem[] = (this.state.stacks[docPath] ?? []).map((number) => ({
      number,
      linked: linkedMap.has(number),
      info: this.cached(github, number)?.info ?? null,
    }));
    if (linked.length > 0 && this.isStale(github, [...linkedMap.keys()], DOC_STALE_MS)) {
      void this.refresh({ docPaths: [docPath] });
    }
    const status = this.lastError?.kind === "unavailable" ? "unavailable" : "ok";
    return { ...base, status, message: this.lastError?.message ?? null, linked, stack };
  }

  attentionFor(doc: DocSummary): PrAttention | null {
    const github = this.options.githubFor(doc.repo);
    if (!github || !this.options.settings.enabled) return null;
    const open = [...this.linkedNumbers(doc).keys()].flatMap((number) => {
      const info = this.cached(github, number)?.info;
      return info && !isTerminal(info) ? [info] : [];
    });
    if (open.some((info) => info.ci === "failing")) return "ci-failing";
    if (open.some((info) => info.review === "changes_requested")) return "changes-requested";
    return null;
  }

  lookup(github: GithubRepo, numbers: readonly number[]): PrLookupResponse {
    if (!this.options.settings.enabled) return { status: "disabled", prs: [] };
    const prs = numbers.flatMap((number) => {
      const cached = this.cached(github, number);
      return cached ? [cached.info] : [];
    });
    const wanted = numbers.filter((number) => {
      const cached = this.cached(github, number);
      return !cached || (!isTerminal(cached.info) && this.ageMs(cached.fetchedAt) > LOOKUP_STALE_MS);
    });
    if (wanted.length > 0) void this.refresh({ docPaths: [], extra: new Map([[repoKey(github), new Set(wanted)]]) });
    return { status: this.lastError?.kind === "unavailable" ? "unavailable" : "ok", prs };
  }

  completedMarker(docPath: string): string | null {
    return this.state.completed[docPath] ?? null;
  }

  async markCompleted(docPath: string, marker: string): Promise<void> {
    this.state.completed[docPath] = marker;
    await this.save();
  }

  async setUnlinked(docPath: string, number: number, unlinked: boolean): Promise<void> {
    const current = new Set(this.state.unlinked[docPath] ?? []);
    if (unlinked) current.add(number);
    else current.delete(number);
    if (current.size > 0) this.state.unlinked[docPath] = [...current].sort((a, b) => a - b);
    else delete this.state.unlinked[docPath];
    const doc = this.options.docs.getDoc(docPath);
    if (doc) this.recomputeStack(doc);
    await this.save();
    this.options.onChange([docPath]);
  }

  refresh(request: { docPaths?: string[]; extra?: Map<string, Set<number>> } = {}): Promise<void> {
    if (!this.options.settings.enabled) return Promise.resolve();
    if (this.running) {
      this.queued = this.mergeQueued(this.queued, request);
      return this.running;
    }
    this.running = this.runRefresh(request.docPaths ? new Set(request.docPaths) : null, request.extra ?? new Map())
      .catch((error: unknown) => this.options.log?.(`PR refresh failed: ${String(error)}`))
      .finally(() => {
        this.running = null;
        const next = this.queued;
        this.queued = null;
        if (next) void this.refresh({ docPaths: next.docPaths ? [...next.docPaths] : undefined, extra: next.extra });
      });
    return this.running;
  }

  private mergeQueued(
    current: { docPaths: Set<string> | null; extra: Map<string, Set<number>> } | null,
    request: { docPaths?: string[]; extra?: Map<string, Set<number>> },
  ): { docPaths: Set<string> | null; extra: Map<string, Set<number>> } {
    const docPaths =
      !request.docPaths || current?.docPaths === null
        ? null
        : new Set([...(current?.docPaths ?? []), ...request.docPaths]);
    const extra = new Map(current?.extra ?? []);
    for (const [repo, numbers] of request.extra ?? [])
      extra.set(repo, new Set([...(extra.get(repo) ?? []), ...numbers]));
    return { docPaths, extra };
  }

  private async runRefresh(docPaths: Set<string> | null, extra: Map<string, Set<number>>): Promise<void> {
    const docs = docPaths
      ? [...docPaths].flatMap((docPath) => this.options.docs.getDoc(docPath) ?? [])
      : this.options.docs.allDocs().filter((doc) => !this.options.isArchived(doc));
    const byRepo = new Map<string, { github: GithubRepo; numbers: Set<number>; docs: DocSummary[] }>();
    const entryFor = (github: GithubRepo) => {
      const key = repoKey(github);
      const entry = byRepo.get(key) ?? { github, numbers: new Set<number>(), docs: [] };
      byRepo.set(key, entry);
      return entry;
    };
    for (const doc of docs) {
      const github = this.options.githubFor(doc.repo);
      if (!github) continue;
      const linked = this.linkedNumbers(doc);
      if (linked.size === 0 && !(doc.path in this.state.stacks)) continue;
      const entry = entryFor(github);
      entry.docs.push(doc);
      for (const number of [...linked.keys(), ...(this.state.stacks[doc.path] ?? [])]) entry.numbers.add(number);
    }
    for (const [key, numbers] of extra) {
      const [owner = "", repo = ""] = key.split("/");
      const github = byRepo.get(key)?.github ?? { owner, repo };
      for (const number of numbers) entryFor(github).numbers.add(number);
    }
    if (!docPaths) this.lastFullRefresh = this.now();
    try {
      for (const entry of byRepo.values()) await this.refreshRepo(entry.github, entry.numbers);
      this.lastError = null;
    } catch (error) {
      this.lastError =
        error instanceof GhUnavailableError
          ? { kind: "unavailable", message: error.message }
          : { kind: "error", message: error instanceof Error ? error.message : String(error) };
      this.options.log?.(`PR refresh: ${this.lastError.message}`);
    }
    const touched = [...byRepo.values()].flatMap((entry) => entry.docs);
    for (const doc of touched) this.recomputeStack(doc);
    await this.save();
    const paths = touched.map((doc) => doc.path);
    if (paths.length > 0 || extra.size > 0) this.options.onChange(paths);
    if (paths.length > 0) this.options.onPrsSettled?.(paths);
  }

  private async refreshRepo(github: GithubRepo, numbers: Set<number>): Promise<void> {
    const key = repoKey(github);
    let toFetch = [...numbers].filter((number) => {
      const cached = this.cached(github, number);
      return !cached || !isTerminal(cached.info);
    });
    let mergeChecks = this.pendingMergeChecks(github, [...numbers]);
    let seeds = [...numbers];
    const visitedRefs = new Set<string>();
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const { parentsOf, childrenOf } = this.neighbourRefs(github, seeds, visitedRefs);
      if (toFetch.length === 0 && parentsOf.length === 0 && childrenOf.length === 0 && mergeChecks.length === 0) break;
      const fetched: number[] = [];
      for (const query of this.chunkQueries(github, { toFetch, parentsOf, childrenOf, mergeChecks })) {
        const result = parseRepoQuery(await this.options.runner(buildRepoQuery(query)));
        if (result.trunk) this.state.trunks[key] = result.trunk;
        this.applyResult(github, result);
        fetched.push(...result.prs.map((raw) => raw.number));
      }
      mergeChecks = this.pendingMergeChecks(github, fetched);
      seeds = fetched;
      toFetch = [];
    }
    this.state.refreshedAt[key] = new Date(this.now()).toISOString();
  }

  private *chunkQueries(
    github: GithubRepo,
    work: { toFetch: number[]; parentsOf: string[]; childrenOf: string[]; mergeChecks: MergeCheck[] },
  ): Generator<RepoQuery> {
    const trunk = this.state.trunks[repoKey(github)] ?? null;
    const slice = <T>(items: T[], index: number, size: number) => items.slice(index * size, (index + 1) * size);
    const chunks = Math.max(
      Math.ceil(work.toFetch.length / PRS_PER_QUERY),
      Math.ceil(work.parentsOf.length / REFS_PER_QUERY),
      Math.ceil(work.childrenOf.length / REFS_PER_QUERY),
      Math.ceil(work.mergeChecks.length / PRS_PER_QUERY),
    );
    for (let index = 0; index < chunks; index += 1) {
      yield {
        owner: github.owner,
        repo: github.repo,
        numbers: slice(work.toFetch, index, PRS_PER_QUERY),
        parentsOf: slice(work.parentsOf, index, REFS_PER_QUERY),
        childrenOf: slice(work.childrenOf, index, REFS_PER_QUERY),
        mergeChecks: slice(work.mergeChecks, index, PRS_PER_QUERY),
        trunk,
      };
    }
  }

  private applyResult(github: GithubRepo, result: ReturnType<typeof parseRepoQuery>): void {
    const fetchedAt = new Date(this.now()).toISOString();
    const queueLabels = new Set(this.options.settings.mergeQueueLabels);
    for (const raw of result.prs) {
      const known = this.cached(github, raw.number);
      const headlines = result.mergeHeadlines.get(raw.number);
      const landed = headlines ? landedOnTrunk(raw.number, headlines) : known?.info.state === "merged";
      const trunkChecked = headlines !== undefined || raw.state !== "CLOSED" || raw.merged || landed;
      const info = toPrInfo(raw, github.owner, github.repo, queueLabels, landed);
      this.state.prs[prKey(github.owner, github.repo, raw.number)] = { info, fetchedAt, trunkChecked };
    }
    for (const [number, headlines] of result.mergeHeadlines) {
      const cached = this.cached(github, number);
      if (!cached || result.prs.some((raw) => raw.number === number)) continue;
      const landed = landedOnTrunk(number, headlines);
      this.state.prs[prKey(github.owner, github.repo, number)] = {
        ...cached,
        trunkChecked: true,
        info: landed ? { ...cached.info, state: "merged", mergedAt: cached.info.closedAt } : cached.info,
      };
    }
  }

  private neighbourRefs(
    github: GithubRepo,
    numbers: readonly number[],
    visited: Set<string>,
  ): { parentsOf: string[]; childrenOf: string[] } {
    const trunk = this.state.trunks[repoKey(github)];
    const parentsOf: string[] = [];
    const childrenOf: string[] = [];
    for (const number of new Set(numbers)) {
      const info = this.cached(github, number)?.info;
      if (!info || isTerminal(info)) continue;
      if (info.baseRef !== trunk && !visited.has(`h:${info.baseRef}`)) {
        visited.add(`h:${info.baseRef}`);
        parentsOf.push(info.baseRef);
      }
      if (!visited.has(`b:${info.headRef}`)) {
        visited.add(`b:${info.headRef}`);
        childrenOf.push(info.headRef);
      }
    }
    return { parentsOf, childrenOf };
  }

  private pendingMergeChecks(github: GithubRepo, numbers: readonly number[]): MergeCheck[] {
    return numbers.flatMap((number) => {
      const cached = this.cached(github, number);
      if (!cached || cached.trunkChecked || cached.info.state !== "closed" || !cached.info.closedAt) return [];
      return [{ number, closedAt: cached.info.closedAt }];
    });
  }

  private recomputeStack(doc: DocSummary): void {
    const github = this.options.githubFor(doc.repo);
    if (!github) return;
    const linked = [...this.linkedNumbers(doc).keys()];
    if (linked.length === 0) {
      delete this.state.stacks[doc.path];
      return;
    }
    const current = this.connectedStack(github, linked);
    const previous = this.state.stacks[doc.path] ?? [];
    const kept = previous.filter((number) => {
      const info = this.cached(github, number)?.info;
      return !current.includes(number) && info !== undefined && isTerminal(info);
    });
    this.state.stacks[doc.path] = [...kept, ...current].slice(-MAX_STACK);
  }

  private connectedStack(github: GithubRepo, linked: readonly number[]): number[] {
    const all = this.cachedInRepo(github);
    const byHead = new Map<string, PrInfo[]>();
    const byBase = new Map<string, PrInfo[]>();
    for (const info of all) {
      byHead.set(info.headRef, [...(byHead.get(info.headRef) ?? []), info]);
      byBase.set(info.baseRef, [...(byBase.get(info.baseRef) ?? []), info]);
    }
    const parentOf = (info: PrInfo): PrInfo | null => {
      const candidates = (byHead.get(info.baseRef) ?? []).filter((parent) => parent.number !== info.number);
      return (
        candidates.find((parent) => !isTerminal(parent)) ?? candidates.sort((a, b) => b.number - a.number)[0] ?? null
      );
    };
    const childrenOf = (info: PrInfo): PrInfo[] =>
      isTerminal(info)
        ? []
        : (byBase.get(info.headRef) ?? []).filter((child) => !isTerminal(child)).sort((a, b) => a.number - b.number);
    const component = new Map<number, PrInfo>();
    const queue = linked.flatMap((number) => this.cached(github, number)?.info ?? []);
    while (queue.length > 0 && component.size < MAX_STACK) {
      const info = queue.shift();
      if (!info || component.has(info.number)) continue;
      component.set(info.number, info);
      const parent = parentOf(info);
      if (parent && !isTerminal(info)) queue.push(parent);
      queue.push(...childrenOf(info));
    }
    const ordered: number[] = [];
    const visit = (info: PrInfo): void => {
      if (ordered.includes(info.number)) return;
      ordered.push(info.number);
      for (const child of childrenOf(info)) if (component.has(child.number)) visit(child);
    };
    const roots = [...component.values()]
      .filter((info) => {
        const parent = parentOf(info);
        return !parent || !component.has(parent.number) || parent.number === info.number;
      })
      .sort((a, b) => a.number - b.number);
    for (const root of roots) visit(root);
    for (const info of component.values()) if (!ordered.includes(info.number)) ordered.push(info.number);
    return ordered;
  }

  private cachedInRepo(github: GithubRepo): PrInfo[] {
    const prefix = `${repoKey(github)}#`;
    return Object.entries(this.state.prs)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, entry]) => entry.info);
  }

  private cached(github: GithubRepo, number: number): CachedPr | undefined {
    return this.state.prs[prKey(github.owner, github.repo, number)];
  }

  private ageMs(iso: string): number {
    return this.now() - Date.parse(iso);
  }

  private isStale(github: GithubRepo, numbers: readonly number[], maxAgeMs: number): boolean {
    return numbers.some((number) => {
      const cached = this.cached(github, number);
      return !cached || (!isTerminal(cached.info) && this.ageMs(cached.fetchedAt) > maxAgeMs);
    });
  }

  private sessionPrs(): Map<string, SubmittedPr[]> {
    if (this.sessionIndex) return this.sessionIndex;
    const index = new Map<string, SubmittedPr[]>();
    for (const session of this.options.sessions.all()) {
      if (session.submittedPrs.length === 0) continue;
      const docs = new Set([...session.writtenDocPaths, ...session.plannedDocPaths, ...session.builtDocPaths]);
      for (const docPath of docs) index.set(docPath, [...(index.get(docPath) ?? []), ...session.submittedPrs]);
    }
    this.sessionIndex = index;
    return index;
  }

  private async save(): Promise<void> {
    await mkdir(this.options.stateDir, { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state));
    await rename(temporary, this.statePath);
  }
}
