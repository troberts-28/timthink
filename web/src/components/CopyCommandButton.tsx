import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useToast } from "../lib/toast";

const COPIED_FEEDBACK_MS = 1500;

export function CopyCommandButton({ command, label }: { command: string; label: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
      toast(
        <>
          Copied <code className="font-mono text-[12.5px]">{command}</code>
        </>,
      );
    } catch {
      toast("Couldn't copy to the clipboard", "bad");
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={`Copy “${command}”`}
      aria-label={label}
      className="grid size-8 flex-none place-items-center rounded-button text-ink-64 transition-colors duration-150 hover:bg-bg-sunken hover:text-ink"
    >
      {copied ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}
