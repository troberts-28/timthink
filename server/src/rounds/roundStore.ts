import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../reviews/atomicWrite.js";
import { withFileLock } from "../reviews/fileLock.js";
import { RoundError } from "./operations.js";
import { ROUND_ID_PATTERN, type Round, type RoundInput, roundInputSchema, roundSchema } from "./schema.js";

export const ROUNDS_DIR = "rounds";

export interface NewRound {
  input: unknown;
  repo: string;
  project: string | null;
  cwd: string | null;
  now: string;
}

export class RoundStore {
  readonly dir: string;

  constructor(stateDir: string) {
    this.dir = path.join(stateDir, ROUNDS_DIR);
  }

  async list(): Promise<Round[]> {
    const names = await readdir(this.dir).catch(() => []);
    const rounds = await Promise.all(names.flatMap((name) => roundIdOf(name) ?? []).map((id) => this.find(id)));
    return rounds.filter((round) => round !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async find(id: string): Promise<Round | null> {
    if (!ROUND_ID_PATTERN.test(id)) {
      return null;
    }
    const text = await readFile(this.filePath(id), "utf8").catch(() => null);
    if (text === null) {
      return null;
    }
    const parsed = roundSchema.safeParse(parseJson(text));
    return parsed.success ? parsed.data : null;
  }

  async read(id: string): Promise<Round> {
    const round = await this.find(id);
    if (!round) {
      throw new RoundError("not-found", `There is no round ${id}`);
    }
    return round;
  }

  async create({ input, repo, project, cwd, now }: NewRound): Promise<Round> {
    const parsed = roundInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new RoundError("invalid", formatIssues(parsed.error.issues));
    }
    const roundRepo = parsed.data.repo ?? repo;
    const lifecycle = {
      id: newRoundId(roundRepo, parsed.data),
      repo: roundRepo,
      project,
      cwd,
      createdAt: now,
      state: "open" as const,
      submittedAt: null,
      decisions: {},
      outcomes: {},
      waiter: null,
    };
    const round: Round =
      parsed.data.kind === "pr-comments"
        ? { ...parsed.data, ...lifecycle }
        : { ...parsed.data, ...lifecycle, applyError: null };
    await mkdir(this.dir, { recursive: true });
    await writeFileAtomic(this.filePath(round.id), `${JSON.stringify(round, null, 2)}\n`);
    return round;
  }

  async update(id: string, change: (round: Round) => Round): Promise<Round> {
    if (!ROUND_ID_PATTERN.test(id)) {
      throw new RoundError("not-found", `There is no round ${id}`);
    }
    return withFileLock(`${this.filePath(id)}.lock`, async () => {
      const next = change(await this.read(id));
      await writeFileAtomic(this.filePath(id), `${JSON.stringify(next, null, 2)}\n`);
      return next;
    });
  }

  filePath(id: string) {
    return path.join(this.dir, `${id}.json`);
  }
}

export function roundIdOf(fileName: string) {
  if (!fileName.endsWith(".json") || fileName.startsWith(".")) {
    return null;
  }
  const id = fileName.slice(0, -".json".length);
  return ROUND_ID_PATTERN.test(id) ? id : null;
}

function newRoundId(repo: string, input: RoundInput) {
  const slug = repo.replace(/[^\w-]+/g, "-").slice(0, 40);
  const scope = input.kind === "pr-comments" ? (input.prs[0]?.number ?? 0) : "moves";
  return `${slug}-${scope}-${randomBytes(2).toString("hex")}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatIssues(issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>) {
  return issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join(".") || "(round)"}: ${issue.message}`)
    .join("\n");
}
