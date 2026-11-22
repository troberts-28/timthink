import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  type CheckProblem,
  checkDoc,
  expandHome,
  isPageFile,
  type MermaidFailure,
  type PageBuildError,
  ProjectRegistry,
  type TimthinkConfig,
} from "@timthink/server";
import { checkPage } from "./checkPage.js";

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

async function projectManifestProblems(docsRoot: string, relative: string) {
  const registry = new ProjectRegistry(docsRoot);
  await registry.scan();
  const docPath = relative.split(path.sep).join("/");
  const project = registry.projectForPath(docPath);
  const area = registry.areaForPath(docPath);
  return [
    ...(area?.problems ?? []).map(
      (problem) => `${path.join(docsRoot, area?.id ?? "", "area.yaml")}: error: ${problem}`,
    ),
    ...(project?.problems ?? []).map(
      (problem) => `${path.join(docsRoot, project?.id ?? "", "project.yaml")}: error: ${problem}`,
    ),
  ];
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
  if (isPageFile(docFile)) {
    return runPageCheck(config.docsRoot, docFile, io);
  }
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
  const relative = path.relative(config.docsRoot, docFile);
  if (relative.startsWith("..")) {
    io.out(`note: ${docFile} is outside docsRoot (${config.docsRoot}), so the hub won't show it`);
  }
  const manifestProblems = relative.startsWith("..") ? [] : await projectManifestProblems(config.docsRoot, relative);
  for (const problem of manifestProblems) io.out(problem);
  const errors = problems.filter((problem) => problem.severity === "error").length + manifestProblems.length;
  const warnings = problems.length + manifestProblems.length - errors;
  io.out(summaryLine(errors, warnings));
  return errors > 0 ? 1 : 0;
}

async function runPageCheck(docsRoot: string, pageFile: string, io: CheckIo) {
  if (!(await exists(pageFile))) {
    io.err(`Can't read ${pageFile}`);
    return 1;
  }
  const problems = await checkPage({ docsRoot, pageFile });
  const display = path.relative(process.cwd(), pageFile) || pageFile;
  for (const problem of problems) {
    io.out(`${pageProblemLocation(problem, display)}: error: ${problem.message}`);
  }
  io.out(summaryLine(problems.length, 0));
  return problems.length > 0 ? 1 : 0;
}

function pageProblemLocation(problem: PageBuildError, fallback: string) {
  const file = problem.file ? path.relative(process.cwd(), problem.file) || problem.file : fallback;
  return problem.line === null ? file : `${file}:${problem.line}:${(problem.column ?? 0) + 1}`;
}

function summaryLine(errors: number, warnings: number) {
  return errors + warnings === 0
    ? "No problems found."
    : `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`;
}
