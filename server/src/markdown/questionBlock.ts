export interface QuestionBlock {
  id: string | null;
  prompt: string;
  options: string[];
}

const OPTION_LINE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;

export function parseQuestionBlock(code: string, attributes: Record<string, string>): QuestionBlock {
  const promptLines: string[] = [];
  const options: string[] = [];
  for (const line of code.split("\n")) {
    const option = OPTION_LINE.exec(line);
    if (option?.[1]) options.push(option[1].trim());
    else if (line.trim() && options.length === 0) promptLines.push(line.trim());
  }
  return { id: attributes.id ?? null, prompt: promptLines.join(" "), options };
}

const RECOMMENDED = /\s*\((?:recommended|preferred)\)\s*$/i;

export function splitRecommended(option: string): { text: string; recommended: boolean } {
  return RECOMMENDED.test(option)
    ? { text: option.replace(RECOMMENDED, ""), recommended: true }
    : { text: option, recommended: false };
}
