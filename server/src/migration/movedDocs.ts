import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../reviews/atomicWrite.js";

export const MOVES_FILE = "moves.json";

const MAX_CHAIN = 20;

const movesFileSchema = z.object({ version: z.literal(1), moves: z.record(z.string(), z.string()) });

export class MovedDocs {
  private moves: Record<string, string> = {};

  constructor(private readonly stateDir: string) {}

  get filePath() {
    return path.join(this.stateDir, MOVES_FILE);
  }

  async load() {
    const text = await readFile(this.filePath, "utf8").catch(() => null);
    const parsed = text === null ? null : movesFileSchema.safeParse(parseJson(text));
    this.moves = parsed?.success ? parsed.data.moves : {};
  }

  resolve(docPath: string) {
    let current = docPath;
    for (let hops = 0; hops < MAX_CHAIN; hops++) {
      const next = this.moves[current];
      if (next === undefined || next === docPath) {
        return current;
      }
      current = next;
    }
    return current;
  }

  movedTo(docPath: string) {
    const resolved = this.resolve(docPath);
    return resolved === docPath ? null : resolved;
  }

  async record(moves: ReadonlyMap<string, string>) {
    this.moves = { ...this.moves, ...Object.fromEntries(moves) };
    await mkdir(this.stateDir, { recursive: true });
    await writeFileAtomic(this.filePath, `${JSON.stringify({ version: 1, moves: this.moves }, null, 2)}\n`);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
