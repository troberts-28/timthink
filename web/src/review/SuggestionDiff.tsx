import { useMemo } from "react";
import { wordDiff } from "./wordDiff";

export function SuggestionDiff({
  before,
  after,
  className = "",
}: {
  before: string;
  after: string;
  className?: string;
}) {
  const parts = useMemo(() => wordDiff(before, after), [before, after]);
  return (
    <p
      className={`suggestion-diff m-0 whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] ${className}`}
    >
      {parts.map((part, index) => {
        const key = `${index}-${part.kind}`;
        if (part.kind === "removed") return <del key={key}>{part.text}</del>;
        if (part.kind === "added") return <ins key={key}>{part.text}</ins>;
        return <span key={key}>{part.text}</span>;
      })}
    </p>
  );
}
