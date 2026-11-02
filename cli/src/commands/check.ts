import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { type CheckProblem, checkDoc, expandHome, type MermaidFailure, type TimthinkConfig } from "@timthink/server";

type MermaidParser = (code: string) => Promise<MermaidFailure | null>;

const MERMAID_LINE = /line (\d+)/i;

async function exists(absolute: string): Promise<boolean> {
  return access(absolute).then(
    () => true,
    () => false,
  );
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n").find((line) => line.trim() && !/^Parse error on line/i.test(line)) ?? message;
}

export async function loadMermaidParser(): Promise<MermaidParser | null> {
  try {
    const { JSDOM } = await import("jsdom");
    const { window } = new JSDOM("");
    Object.assign(globalThis, { window, document: window.document });
    const mermaid = (await import("mermaid")).default;
    return async (code) => {
      try {
        await mermaid.parse(code);
        return null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const line = MERMAID_LINE.exec(message)?.[1];
        return { line: line ? Number(line) : null, message: firstLine(error) };
      }
    };
  } catch {
    return null;
  }
}

function formatProblem(file: string, problem: CheckProblem): string {
  return `${file}:${problem.line}: ${problem.severity}: ${problem.message}`;
}

export interface CheckIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

export async function runCheck(
  config: Pick<TimthinkConfig, "docsRoot">,
  input: string,
  io: CheckIo,
  loadParser: () => Promise<MermaidParser | null> = loadMermaidParser,
): Promise<number> {
  const docFile = path.resolve(expandHome(input));
  const raw = await readFile(docFile, "utf8").catch(() => null);
  if (raw === null) {
    io.err(`Can't read ${docFile}`);
    return 1;
  }
  const needsMermaid = /^ {0,3}(?:`{3,}|~{3,})\s*mermaid/im.test(raw);
  const { problems, notes } = await checkDoc({
    raw,
    docFile,
    fileExists: exists,
    parseMermaid: needsMermaid ? await loadParser() : null,
  });
  const display = path.relative(process.cwd(), docFile) || docFile;
  for (const problem of problems) io.out(formatProblem(display, problem));
  for (const note of notes) io.out(`note: ${note}`);
  if (path.relative(config.docsRoot, docFile).startsWith("..")) {
    io.out(`note: ${docFile} is outside docsRoot (${config.docsRoot}), so the hub won't show it`);
  }
  const errors = problems.filter((problem) => problem.severity === "error").length;
  const warnings = problems.length - errors;
  io.out(
    errors + warnings === 0
      ? "No problems found."
      : `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`,
  );
  return errors > 0 ? 1 : 0;
}
