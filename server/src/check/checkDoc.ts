import path from "node:path";
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from "yaml";
import { type Fence, parseInfoString, scanFences } from "../markdown/fences.js";
import { detailsSections, parseQuestionBlock, type QuestionBlock } from "../markdown/questionBlock.js";

export const KNOWN_STATUSES = ["draft", "review", "approved", "in-progress", "done", "abandoned"] as const;

export type Severity = "error" | "warning";

export interface CheckProblem {
  line: number;
  severity: Severity;
  message: string;
}

export interface MermaidFailure {
  line: number | null;
  message: string;
}

export interface CheckInput {
  raw: string;
  docFile: string;
  fileExists: (absolute: string) => Promise<boolean>;
  parseMermaid: ((code: string) => Promise<MermaidFailure | null>) | null;
}

export interface CheckResult {
  problems: CheckProblem[];
  notes: string[];
}

const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const PR_NUMBER = /^#?\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const INLINE_LINK = /!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g;
const LINK_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/;
const INLINE_CODE = /(`+)[\s\S]*?\1/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i;
const TEMPLATED = /[{}$]/;
const STATUS_SUGGESTIONS: Record<string, string> = {
  active: "in-progress",
  "in progress": "in-progress",
  wip: "in-progress",
  complete: "done",
  completed: "done",
  shipped: "done",
  "needs-review": "review",
};

function lineAt(raw: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < raw.length; index += 1) {
    if (raw[index] === "\n") line += 1;
  }
  return line;
}

function checkFrontmatter(raw: string): CheckProblem[] {
  const match = FRONTMATTER_PATTERN.exec(raw);
  if (!match) return [];
  const yamlText = match[1] ?? "";
  const lineCounter = new LineCounter();
  const document = parseDocument(yamlText, { lineCounter, prettyErrors: false });
  const firstLine = 2;
  if (document.errors.length > 0) {
    return document.errors.map((error) => ({
      line: firstLine + (lineCounter.linePos(error.pos[0]).line - 1),
      severity: "error",
      message: `Malformed frontmatter: ${error.message.split("\n")[0]}`,
    }));
  }
  if (document.contents === null) return [];
  if (!isMap(document.contents))
    return [{ line: firstLine, severity: "error", message: "Frontmatter isn't a mapping" }];
  const problems: CheckProblem[] = [];
  for (const pair of document.contents.items) {
    if (!isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const line = firstLine + (lineCounter.linePos(pair.key.range?.[0] ?? 0).line - 1);
    const value = isScalar(pair.value)
      ? pair.value.value
      : isSeq(pair.value)
        ? pair.value.items.map((item) => (isScalar(item) ? item.value : undefined))
        : pair.value === null
          ? null
          : undefined;
    const problem = fieldProblem(key, value);
    if (problem) problems.push({ line, ...problem });
  }
  return problems;
}

function isPrNumber(value: unknown): boolean {
  if (typeof value === "number") return Number.isInteger(value);
  return typeof value === "string" && PR_NUMBER.test(value.trim());
}

function fieldProblem(key: string, value: unknown): Omit<CheckProblem, "line"> | null {
  switch (key) {
    case "status": {
      if (typeof value === "string" && (KNOWN_STATUSES as readonly string[]).includes(value)) return null;
      const suggestion = typeof value === "string" ? STATUS_SUGGESTIONS[value.toLowerCase()] : undefined;
      const hint = suggestion ? ` (did you mean ${suggestion}?)` : "";
      return { severity: "error", message: `status must be one of ${KNOWN_STATUSES.join(", ")}${hint}` };
    }
    case "pr": {
      const values = Array.isArray(value) ? value : [value];
      if (values.length > 0 && values.every(isPrNumber)) return null;
      return { severity: "error", message: "pr must be a pull request number, or a list of them" };
    }
    case "title":
    case "project":
    case "branch":
    case "linear":
      return typeof value === "string" || typeof value === "number"
        ? null
        : { severity: "error", message: `${key} must be a single line of text` };
    case "date":
      if (value instanceof Date || (typeof value === "string" && ISO_DATE.test(value))) return null;
      return { severity: "warning", message: "date should be YYYY-MM-DD" };
    default:
      return null;
  }
}

function checkQuestionDetails(question: QuestionBlock, fence: Fence): CheckProblem[] {
  const details = question.details;
  if (!details) {
    return [
      {
        line: fence.line,
        severity: "warning",
        message: "question block has no details: add `---` then ### Context, ### Options and ### Recommendation",
      },
    ];
  }
  const dividerLine = fence.contentLine + details.lineIndex - 1;
  const problems: CheckProblem[] = [];
  if (!detailsSections(details.markdown).includes("recommendation")) {
    problems.push({ line: dividerLine, severity: "warning", message: "question details have no ### Recommendation" });
  }
  for (const nested of scanFences(details.markdown).filter((candidate) => !candidate.closed)) {
    problems.push({
      line: dividerLine + nested.line,
      severity: "error",
      message: `this fence ends the question block early: open the question with more backticks (${"`".repeat(4)}question)`,
    });
  }
  return problems;
}

function checkQuestions(fences: readonly Fence[]): CheckProblem[] {
  const problems: CheckProblem[] = [];
  const seen = new Map<string, number>();
  for (const fence of fences.filter((candidate) => candidate.lang === "question")) {
    const question = parseQuestionBlock(fence.content, parseInfoString(fence.meta));
    const line = fence.line;
    if (!question.id) {
      problems.push({ line, severity: "error", message: "question block needs an id (```question id=some-id)" });
    } else if (seen.has(question.id)) {
      problems.push({
        line,
        severity: "error",
        message: `question id "${question.id}" is already used on line ${seen.get(question.id)}`,
      });
    } else {
      seen.set(question.id, line);
    }
    if (!question.prompt) problems.push({ line, severity: "warning", message: "question block has no prompt line" });
    if (question.options.length < 2) {
      problems.push({ line, severity: "error", message: "question block needs at least two `- option` lines" });
    }
    if (question.options.filter((option) => option.recommended).length > 1) {
      problems.push({ line, severity: "error", message: "mark at most one option (recommended)" });
    }
    problems.push(...checkQuestionDetails(question, fence));
  }
  return problems;
}

function questionDetailFences(fences: readonly Fence[]): Fence[] {
  return fences
    .filter((fence) => fence.lang === "question")
    .flatMap((fence) => {
      const details = parseQuestionBlock(fence.content, {}).details;
      if (!details) return [];
      const lineShift = fence.contentLine + details.lineIndex - 1;
      return scanFences(details.markdown).map((nested) => ({
        ...nested,
        line: nested.line + lineShift,
        contentLine: nested.contentLine + lineShift,
      }));
    });
}

async function checkMermaid(fences: readonly Fence[], input: CheckInput, notes: string[]): Promise<CheckProblem[]> {
  const diagrams = [...fences, ...questionDetailFences(fences)].filter((fence) => fence.lang === "mermaid");
  if (diagrams.length === 0) return [];
  if (!input.parseMermaid) {
    notes.push(`Skipped ${diagrams.length} mermaid diagram(s): the mermaid parser isn't available.`);
    return [];
  }
  const problems: CheckProblem[] = [];
  for (const fence of diagrams) {
    const failure = await input.parseMermaid(fence.content);
    if (!failure) continue;
    const line = failure.line === null ? fence.line : fence.contentLine + failure.line - 1;
    problems.push({ line, severity: "error", message: `mermaid: ${failure.message}` });
  }
  return problems;
}

function relativeTarget(target: string): string | null {
  if (EXTERNAL.test(target) || TEMPLATED.test(target)) return null;
  const withoutFragment = target.split(/[?#]/)[0] ?? "";
  if (!withoutFragment) return null;
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
}

interface LinkTarget {
  target: string;
  line: number;
  image: boolean;
}

function linkTargets(raw: string, fences: readonly Fence[]): LinkTarget[] {
  const inFence = (offset: number) => fences.some((fence) => offset >= fence.start && offset < fence.end);
  const found: LinkTarget[] = [];
  let offset = 0;
  raw.split("\n").forEach((line, index) => {
    if (!inFence(offset)) {
      const prose = line.replace(INLINE_CODE, (code) => " ".repeat(code.length));
      for (const match of prose.matchAll(INLINE_LINK)) {
        if (match[1]) found.push({ target: match[1], line: index + 1, image: match[0].startsWith("!") });
      }
      const definition = LINK_DEFINITION.exec(prose);
      if (definition?.[1]) found.push({ target: definition[1], line: index + 1, image: false });
    }
    offset += line.length + 1;
  });
  return found;
}

async function checkFiles(raw: string, fences: readonly Fence[], input: CheckInput): Promise<CheckProblem[]> {
  const problems: CheckProblem[] = [];
  const docDir = path.dirname(input.docFile);
  for (const fence of fences.filter((candidate) => candidate.lang === "demo")) {
    const src = parseInfoString(fence.meta).src;
    if (!src) {
      problems.push({ line: fence.line, severity: "error", message: "demo block needs a src (```demo src=file.html)" });
    } else if (!(await input.fileExists(path.resolve(docDir, src)))) {
      problems.push({ line: fence.line, severity: "error", message: `demo src ${src} doesn't exist` });
    }
  }
  for (const { target, line, image } of linkTargets(raw, fences)) {
    const relative = relativeTarget(target);
    const checked = relative !== null && (image || relative.toLowerCase().endsWith(".md"));
    if (checked && !(await input.fileExists(path.resolve(docDir, relative)))) {
      problems.push({ line, severity: "error", message: `link target ${target} doesn't exist` });
    }
  }
  return problems;
}

function checkFences(raw: string, fences: readonly Fence[]): CheckProblem[] {
  return fences
    .filter((fence) => !fence.closed)
    .map((fence) => ({ line: lineAt(raw, fence.start), severity: "error", message: "code fence is never closed" }));
}

export async function checkDoc(input: CheckInput): Promise<CheckResult> {
  const notes: string[] = [];
  const fences = scanFences(input.raw);
  const problems = [
    ...checkFrontmatter(input.raw),
    ...checkFences(input.raw, fences),
    ...checkQuestions(fences),
    ...(await checkMermaid(fences, input, notes)),
    ...(await checkFiles(input.raw, fences, input)),
  ].sort((a, b) => a.line - b.line);
  return { problems, notes };
}
