import { parseDocument, stringify } from "yaml";

export class FrontmatterEditError extends Error {}

const BOM = "﻿";
const OPENING_LINE = /^---[ \t]*$/;
const CLOSING_LINE = /^---[ \t]*$/;
const STATUS_VALUE = /^[a-z][a-z-]*$/;
export const MAX_TITLE_LENGTH = 200;
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
    if (close === -1) throw new FrontmatterEditError("The value has an unterminated quote");
    return { value: value.slice(0, close + 1), comment: value.slice(close + 1) };
  }
  const commentAt = value.search(/[ \t]+#/);
  return commentAt === -1
    ? { value, comment: "" }
    : { value: value.slice(0, commentAt), comment: value.slice(commentAt) };
}

function rewriteValueLine(line: string, key: string, scalar: string): string {
  const colon = line.indexOf(":");
  const afterColon = line.slice(colon + 1);
  const spacing = /^[ \t]*/.exec(afterColon)?.[0] ?? "";
  const rest = afterColon.slice(spacing.length);
  if (rest === "" || rest.startsWith("#") || UNSUPPORTED_VALUE_START.test(rest)) {
    throw new FrontmatterEditError(`The ${key} field uses a multi-line or complex YAML value; edit it by hand`);
  }
  const { comment } = splitTrailingComment(rest);
  return `${line.slice(0, colon + 1)}${spacing || " "}${scalar}${comment}`;
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

function valueInYaml(yamlText: string, key: string): unknown {
  const contents: unknown = parseDocument(yamlText).toJS();
  return contents && typeof contents === "object"
    ? Object.entries(contents).find(([name]) => name === key)?.[1]
    : undefined;
}

function withNewBlock(body: string, line: string): string {
  const eol = preferredEol(body);
  const block = `---${eol}${line}${eol}---${eol}`;
  return body === "" ? block : `${block}${eol}${body}`;
}

export function setFrontmatterStatus(raw: string, status: string): string {
  if (!STATUS_VALUE.test(status)) throw new FrontmatterEditError(`"${status}" isn't a valid status`);
  return setFrontmatterValue(raw, "status", status);
}

export function setFrontmatterTitle(raw: string, title: string): string {
  const trimmed = title.trim();
  if (trimmed === "" || trimmed.length > MAX_TITLE_LENGTH || /[\r\n]/.test(trimmed)) {
    throw new FrontmatterEditError(`A title is one line of 1 to ${MAX_TITLE_LENGTH} characters`);
  }
  return setFrontmatterValue(raw, "title", trimmed);
}

function setFrontmatterValue(raw: string, key: string, value: string): string {
  const scalar = stringify(value).trimEnd();
  const keyLine = new RegExp(`^${key}[ \\t]*:`);
  const bom = raw.startsWith(BOM) ? BOM : "";
  const body = raw.slice(bom.length);
  const lines = splitLines(body);
  const [first] = lines;
  if (!first || !OPENING_LINE.test(first.text) || first.eol === "")
    return bom + withNewBlock(body, `${key}: ${scalar}`);

  const closingIndex = lines.findIndex((line, index) => index > 0 && CLOSING_LINE.test(line.text));
  if (closingIndex === -1) throw new FrontmatterEditError("The frontmatter block has no closing ---");
  const yamlLines = lines.slice(1, closingIndex);
  const yamlText = joinLines(yamlLines);
  assertValidYaml(yamlText);

  const keyIndexes = yamlLines.flatMap((line, index) => (keyLine.test(line.text) ? [index] : []));
  if (keyIndexes.length > 1) throw new FrontmatterEditError(`The frontmatter has more than one ${key} field`);
  const [keyIndex] = keyIndexes;
  let updatedYaml: RawLine[];
  if (keyIndex === undefined) {
    updatedYaml = [...yamlLines, { text: `${key}: ${scalar}`, eol: preferredEol(body) }];
  } else {
    updatedYaml = yamlLines.map((line, index) =>
      index === keyIndex ? { ...line, text: rewriteValueLine(line.text, key, scalar) } : line,
    );
  }
  const updatedYamlText = joinLines(updatedYaml);
  if (valueInYaml(updatedYamlText, key) !== value) {
    throw new FrontmatterEditError(`Couldn't update the ${key} field safely; edit it by hand`);
  }
  return bom + joinLines([first, ...updatedYaml, ...lines.slice(closingIndex)]);
}
