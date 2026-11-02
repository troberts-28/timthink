import type { Root } from "hast";
import { useEffect, useMemo, useState } from "react";
import { codeBlockHast } from "./codeBlockHast";
import { hastToReact } from "./hastToReact";

interface CodeBlockProps {
  code: string;
  lang: string;
  sourceProps: Record<string, string>;
  contentStart: number | null;
  contentEnd: number | null;
}

export function CodeBlock({ code, lang, sourceProps, contentStart, contentEnd }: CodeBlockProps) {
  const [highlighted, setHighlighted] = useState<Root | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHighlighted(null);
    import("./highlight")
      .then(({ highlightToHast }) => highlightToHast(code, lang))
      .then((tree) => {
        if (!cancelled) setHighlighted(tree);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  const tree = useMemo(() => {
    const span = contentStart !== null && contentEnd !== null ? { start: contentStart, end: contentEnd } : null;
    return codeBlockHast(highlighted, code, span);
  }, [highlighted, code, contentStart, contentEnd]);

  return (
    <div className="fence code-block shiki-tokens" {...sourceProps}>
      {lang ? <span className="code-block-lang">{lang}</span> : null}
      {hastToReact(tree)}
    </div>
  );
}
