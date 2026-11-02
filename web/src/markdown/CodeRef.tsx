import type { PublicCodeMatch } from "@timthink/server";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useState } from "react";
import { openCode } from "../api/client";
import { useCodeResolution } from "../api/queries";
import { useToast } from "../lib/toast";
import { useDismiss } from "../lib/useDismiss";
import { usePlanContext } from "./PlanContext";

function refFor(match: PublicCodeMatch): string {
  const line = match.line ? `:${match.line}` : "";
  const col = match.line && match.col ? `:${match.col}` : "";
  return `${match.relPath}${line}${col}`;
}

interface CandidatePickerProps {
  matches: PublicCodeMatch[];
  onPick: (match: PublicCodeMatch) => void;
}

function CandidatePicker({ matches, onPick }: CandidatePickerProps) {
  return (
    <span
      role="menu"
      className="popover-enter absolute top-full left-0 z-30 mt-1.5 flex w-max max-w-[520px] flex-col rounded-button border border-line bg-surface-raised p-1 text-ui shadow-pop"
    >
      <span className="px-2.5 pt-1.5 pb-1 text-meta text-ink-64">{matches.length} files match. Open which?</span>
      {matches.map((match) => (
        <button
          key={match.relPath}
          type="button"
          role="menuitem"
          className="truncate rounded-[8px] px-2.5 py-1.5 text-left font-mono text-[12.5px] text-ink hover:bg-bg-sunken focus-visible:bg-bg-sunken"
          onClick={() => onPick(match)}
        >
          {match.relPath}
        </button>
      ))}
    </span>
  );
}

interface CodeRefProps {
  value: string;
  sourceProps: Record<string, string>;
  children: ReactNode;
}

export function CodeRef({ value, sourceProps, children }: CodeRefProps) {
  const { repo, docPath } = usePlanContext();
  const toast = useToast();
  const resolution = useCodeResolution(repo, value, docPath);
  const [pickerOpen, setPickerOpen] = useState(false);
  const close = () => setPickerOpen(false);
  const containerRef = useDismiss<HTMLSpanElement>(pickerOpen, close);

  const matches = resolution.data?.status === "resolved" ? resolution.data.matches : null;
  if (!matches || matches.length === 0) return <code {...sourceProps}>{children}</code>;

  const open = async (ref: string) => {
    try {
      const result = await openCode(repo, ref, docPath);
      if (result.status === "ambiguous") setPickerOpen(true);
      else if (result.status === "error") toast(`Couldn't open the editor: ${result.message}`, "bad");
      else if (result.status !== "opened") toast(`Couldn't find ${value} in the checkout`, "bad");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't open the editor", "bad");
    }
  };

  const onClick = () => {
    if (matches.length > 1) setPickerOpen((current) => !current);
    else void open(value);
  };

  const onPick = (match: PublicCodeMatch) => {
    close();
    void open(refFor(match));
  };

  const [single] = matches;
  const githubUrl = matches.length === 1 ? single?.githubUrl : null;
  const title = matches.length === 1 ? `Open ${single?.relPath} in editor` : `${matches.length} matching files`;

  return (
    <span ref={containerRef} className="code-ref-wrap relative inline">
      <button type="button" className="code-ref" title={title} aria-expanded={pickerOpen} onClick={onClick}>
        <code {...sourceProps}>{children}</code>
        <span className="code-ref-arrow" aria-hidden>
          ↗
        </span>
      </button>
      {githubUrl ? (
        <a className="code-ref-github" href={githubUrl} target="_blank" rel="noreferrer" title="View on GitHub">
          <ExternalLink className="size-3" aria-hidden />
          View on GitHub
        </a>
      ) : null}
      {pickerOpen ? <CandidatePicker matches={matches} onPick={onPick} /> : null}
    </span>
  );
}
