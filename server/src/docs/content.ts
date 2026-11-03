import { parseFrontmatter } from "../frontmatter.js";
import { parseInfoString, scanFences } from "../markdown/fences.js";
import { parseQuestionBlock, type QuestionBlock } from "../markdown/questionBlock.js";
import { docHash } from "../reviews/paths.js";

export interface DocQuestion extends QuestionBlock {
  line: number;
}

export interface DocContent {
  hash: string;
  questions: DocQuestion[];
  text: string;
}

export function questionsIn(raw: string): DocQuestion[] {
  return scanFences(raw)
    .filter((fence) => fence.lang === "question")
    .map((fence) => ({ ...parseQuestionBlock(fence.content, parseInfoString(fence.meta)), line: fence.line }));
}

export function analyzeContent(raw: string): DocContent {
  return { hash: docHash(raw), questions: questionsIn(raw), text: parseFrontmatter(raw).body };
}
