import { parseDocument } from "yaml";

export class FrontmatterEditError extends Error {}

const BOM = "﻿";
const OPENING_LINE = /^---[ \t]*$/;
const CLOSING_LINE = /^---[ \t]*$/;
const STATUS_KEY = /^status[ \t]*:/;
const STATUS_VALUE = /^[a-z][a-z-]*$/;
const UNSUPPORTED_VALUE_START = /^[|>[{&*!]/;

interface RawLine {
  text: string;
  eol: string;
}

function splitLines(text: string): RawLine[] {
  const lines: RawLine[] = [];
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
    if (match.index === text.length && match[0] === "") break;
    lines.push({ text: match[1] ?? "", eol: match[2] ?? "" });
  }
  return lines;
}

function joinLines(lines: readonly RawLine[]): string {
  return lines.map((line) => line.text + line.eol).join("");
}

function preferredEol(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function splitTrailingComment(value: string): { value: string; comment: string } {
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const close = value.indexOf(quote, 1);
    if (close === -1) throw new FrontmatterEditError("The status value has an unterminated quote");
    return { value: value.slice(0, close + 1), comment: value.slice(close + 1) };
  }
  const commentAt = value.search(/[ \t]+#/);
  return commentAt === -1
    ? { value, comment: "" }
    : { value: value.slice(0, commentAt), comment: value.slice(commentAt) };
}

function rewriteStatusLine(line: string, status: string): string {
  const colon = line.indexOf(":");
  const afterColon = line.slice(colon + 1);
  const spacing = /^[ \t]*/.exec(afterColon)?.[0] ?? "";
  const rest = afterColon.slice(spacing.length);
  if (rest === "" || rest.startsWith("#") || UNSUPPORTED_VALUE_START.test(rest)) {
    throw new FrontmatterEditError("The status field uses a multi-line or complex YAML value; edit it by hand");
  }
  const { comment } = splitTrailingComment(rest);
  return `${line.slice(0, colon + 1)}${spacing || " "}${status}${comment}`;
}

function assertValidYaml(yamlText: string): void {
  const document = parseDocument(yamlText);
  const [error] = document.errors;
  if (error) throw new FrontmatterEditError(`The frontmatter isn't valid YAML: ${error.message.split("\n")[0]}`);
  const contents: unknown = document.toJS();
  if (contents !== null && contents !== undefined && (typeof contents !== "object" || Array.isArray(contents))) {
    throw new FrontmatterEditError("The frontmatter isn't a YAML mapping");
  }
}

function statusInYaml(yamlText: string): unknown {
  const contents: unknown = parseDocument(yamlText).toJS();
  return contents && typeof contents === "object" ? (contents as Record<string, unknown>).status : undefined;
}

function withNewBlock(body: string, status: string): string {
  const eol = preferredEol(body);
  const block = `---${eol}status: ${status}${eol}---${eol}`;
  return body === "" ? block : `${block}${eol}${body}`;
}

export function setFrontmatterStatus(raw: string, status: string): string {
  if (!STATUS_VALUE.test(status)) throw new FrontmatterEditError(`"${status}" isn't a valid status`);
  const bom = raw.startsWith(BOM) ? BOM : "";
  const body = raw.slice(bom.length);
  const lines = splitLines(body);
  const [first] = lines;
  if (!first || !OPENING_LINE.test(first.text) || first.eol === "") return bom + withNewBlock(body, status);

  const closingIndex = lines.findIndex((line, index) => index > 0 && CLOSING_LINE.test(line.text));
  if (closingIndex === -1) throw new FrontmatterEditError("The frontmatter block has no closing ---");
  const yamlLines = lines.slice(1, closingIndex);
  const yamlText = joinLines(yamlLines);
  assertValidYaml(yamlText);

  const statusIndexes = yamlLines.flatMap((line, index) => (STATUS_KEY.test(line.text) ? [index] : []));
  if (statusIndexes.length > 1) throw new FrontmatterEditError("The frontmatter has more than one status field");
  const [statusIndex] = statusIndexes;
  let updatedYaml: RawLine[];
  if (statusIndex === undefined) {
    updatedYaml = [...yamlLines, { text: `status: ${status}`, eol: preferredEol(body) }];
  } else {
    updatedYaml = yamlLines.map((line, index) =>
      index === statusIndex ? { ...line, text: rewriteStatusLine(line.text, status) } : line,
    );
  }
  const updatedYamlText = joinLines(updatedYaml);
  if (statusInYaml(updatedYamlText) !== status) {
    throw new FrontmatterEditError("Couldn't update the status field safely; edit it by hand");
  }
  return bom + joinLines([first, ...updatedYaml, ...lines.slice(closingIndex)]);
}
