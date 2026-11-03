import type { DocDetail } from "@timthink/server";
import { Hammer, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useDocSessions } from "../api/queries";
import { Button } from "../components/Button";
import { useToast } from "../lib/toast";
import { BuildOptions, buildMessage, planForBuild, useBuildOptions } from "./BuildOptions";
import { handOffBuild } from "./buildHandOff";

function BuildDialogPanel({ doc, close }: { doc: DocDetail; close: () => void }) {
  const toast = useToast();
  const titleId = useId();
  const { data } = useDocSessions(doc.summary.path);
  const state = useBuildOptions(planForBuild(doc.summary.path, doc), data?.sessions ?? [], { allowNotNow: false });
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const start = async () => {
    if (!state.branchValid) return;
    setStarting(true);
    const outcome = await handOffBuild(state.target, state.request, state.sessions);
    setStarting(false);
    close();
    const message = buildMessage(outcome);
    if (message) toast(message);
  };

  return (
    <div className="dialog-backdrop fixed inset-0 z-50 grid place-items-center p-6" role="presentation">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog-panel relative flex w-[min(560px,100%)] flex-col gap-5 rounded-card border border-line bg-surface-raised p-6 shadow-modal"
      >
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="m-0 text-[18px] leading-[26px] font-semibold text-ink">
              Build this plan
            </h2>
            <p className="m-0 mt-1 text-ui text-ink-64">
              Starts Claude on <code className="font-mono text-[12.5px]">/timthink build</code>, which follows the plan
              phase by phase and records the branch and PRs back into it.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid size-8 flex-none place-items-center rounded-button text-ink-64 hover:bg-bg-sunken hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <BuildOptions state={state} />
        <footer className="flex items-center justify-end gap-2">
          <Button size="lg" tone="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            size="lg"
            tone="primary"
            icon={<Hammer className="size-4" aria-hidden />}
            disabled={starting || !state.branchValid}
            onClick={() => void start()}
          >
            Copy build command
          </Button>
        </footer>
      </div>
    </div>
  );
}

export function BuildDialog({ doc, open, onClose }: { doc: DocDetail; open: boolean; onClose: () => void }) {
  return open ? <BuildDialogPanel doc={doc} close={onClose} /> : null;
}

export function BuildButton({ status, onClick }: { status: string | null; onClick: () => void }) {
  const ready = status === "approved";
  return (
    <Button
      tone={ready ? "primary" : "ghost"}
      icon={<Hammer className="size-3.5" strokeWidth={2} aria-hidden />}
      onClick={onClick}
      title="Build this plan (b)"
      className={ready ? "" : "border border-line-soft hover:border-line"}
    >
      Build
    </Button>
  );
}
