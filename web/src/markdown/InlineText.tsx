import { Fragment } from "react";

interface TextPart {
  offset: number;
  text: string;
  isCode: boolean;
}

function splitInlineCode(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let offset = 0;
  for (const part of text.split(/(`[^`]+`)/g)) {
    const isCode = part.length > 1 && part.startsWith("`") && part.endsWith("`");
    if (part) parts.push({ offset, text: isCode ? part.slice(1, -1) : part, isCode });
    offset += part.length;
  }
  return parts;
}

export function InlineText({ text }: { text: string }) {
  return (
    <>
      {splitInlineCode(text).map((part) =>
        part.isCode ? <code key={part.offset}>{part.text}</code> : <Fragment key={part.offset}>{part.text}</Fragment>,
      )}
    </>
  );
}
