export interface QuestionOption {
  label: string;
  summary: string | null;
  recommended: boolean;
}

export interface QuestionDetails {
  markdown: string;
  offset: number;
  lineIndex: number;
}

export interface QuestionBlock {
  id: string | null;
  prompt: string;
  options: QuestionOption[];
  details: QuestionDetails | null;
}

export type DetailsSectionKind = "context" | "options" | "recommendation";

const OPTION_LINE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;
const CONTINUATION_LINE = /^\s+\S/;
const DETAILS_DIVIDER = /^ {0,3}---\s*$/;
const RECOMMENDED = /\s*\((?:recommended|preferred)\)\s*$/i;
const HEADING_LINE = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/;
const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const SECTION_NAMES: Record<string, DetailsSectionKind> = {
  context: "context",
  background: "context",
  option: "options",
  options: "options",
  recommendation: "recommendation",
  recommended: "recommendation",
};

function option(text: string): QuestionOption {
  const recommended = RECOMMENDED.test(text);
  return { label: recommended ? text.replace(RECOMMENDED, "") : text, summary: null, recommended };
}

function withSummaryLine(target: QuestionOption, line: string): QuestionOption {
  const text = line.trim();
  return { ...target, summary: target.summary ? `${target.summary} ${text}` : text };
}

function detailsAfter(lines: readonly string[], dividerIndex: number): QuestionDetails | null {
  const lineIndex = dividerIndex + 1;
  const markdown = lines.slice(lineIndex).join("\n");
  if (!markdown.trim()) return null;
  const offset = lines.slice(0, lineIndex).reduce((total, line) => total + line.length + 1, 0);
  return { markdown, offset, lineIndex };
}

export function parseQuestionBlock(code: string, attributes: Record<string, string>): QuestionBlock {
  const lines = code.split("\n");
  const promptLines: string[] = [];
  const options: QuestionOption[] = [];
  let details: QuestionDetails | null = null;
  for (const [index, line] of lines.entries()) {
    if (DETAILS_DIVIDER.test(line)) {
      details = detailsAfter(lines, index);
      break;
    }
    const optionText = OPTION_LINE.exec(line)?.[1];
    const last = options.at(-1);
    if (optionText) options.push(option(optionText.trim()));
    else if (last && CONTINUATION_LINE.test(line)) options[options.length - 1] = withSummaryLine(last, line);
    else if (line.trim() && options.length === 0) promptLines.push(line.trim());
  }
  return { id: attributes.id ?? null, prompt: promptLines.join(" "), options, details };
}

export function detailsSectionKind(heading: string): DetailsSectionKind | null {
  const name = heading
    .replace(/[*_`:]/g, "")
    .trim()
    .toLowerCase();
  return SECTION_NAMES[name] ?? null;
}

export function detailsSections(markdown: string): DetailsSectionKind[] {
  const kinds: DetailsSectionKind[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    if (fence === null) {
      fence = OPENING_FENCE.exec(line)?.[1] ?? null;
    } else {
      const marker = CLOSING_FENCE.exec(line)?.[1];
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    const heading = fence === null ? HEADING_LINE.exec(line)?.[1] : undefined;
    const kind = heading ? detailsSectionKind(heading) : null;
    if (kind) kinds.push(kind);
  }
  return kinds;
}
