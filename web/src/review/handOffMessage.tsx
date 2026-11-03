import type { ReactNode } from "react";
import type { HandOffOutcome } from "./handOff";

export function CommandCode({ command }: { command: string }) {
  return <code className="font-mono text-[12.5px]">{command}</code>;
}

export function handOffMessage(outcome: HandOffOutcome, startsOn = "your review"): ReactNode {
  if (outcome.kind === "resumed") {
    return `Resuming the session in a new Warp tab. Claude starts on ${startsOn} straight away.`;
  }
  if (!outcome.copied) {
    return (
      <>
        Couldn't copy to the clipboard. Run <CommandCode command={outcome.command} /> in a Claude session.
      </>
    );
  }
  if (outcome.kind === "focused") {
    return (
      <>
        Jumped to the Claude tab. Paste and press Enter to send <CommandCode command={outcome.command} />
      </>
    );
  }
  if (outcome.kind === "possibly-open") {
    return (
      <>
        “{outcome.title}” may already be open in a Warp tab that timthink can't see, so it wasn't resumed. Paste the
        copied <CommandCode command={outcome.command} /> into that tab, or use Resume in the Sessions panel.
      </>
    );
  }
  return (
    <>
      Copied <CommandCode command={outcome.command} />. Paste it into a Claude session.
    </>
  );
}
