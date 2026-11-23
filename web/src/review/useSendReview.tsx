import { useState } from "react";
import { useToast } from "../lib/toast";
import { copyText, reviewCommand } from "./handOff";
import { useRequiredReview } from "./ReviewContext";
import { pendingCounts } from "./reviewModel";

export function useSendReview() {
  const { review, docPath, actions } = useRequiredReview();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    const result = await actions.submit("comment", "");
    setSending(false);
    if (!result) {
      return;
    }
    const command = reviewCommand(docPath);
    toast(
      (await copyText(command)) ? (
        <>
          Sent. Copied <code className="font-mono text-[12.5px]">{command}</code> for Claude.
        </>
      ) : (
        "Sent to Claude."
      ),
    );
  };
  return { counts: pendingCounts(review), sending, send };
}
