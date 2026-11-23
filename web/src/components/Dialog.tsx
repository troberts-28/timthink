import { X } from "lucide-react";
import { type ReactNode, useEffect, useId } from "react";

interface DialogProps {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}

export function Dialog({ title, onClose, busy = false, children }: DialogProps) {
  const titleId = useId();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, busy]);
  return (
    <div className="dialog-backdrop fixed inset-0 z-50 grid place-items-center p-6" role="presentation">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog-panel relative flex w-[min(480px,100%)] flex-col gap-4 rounded-card border border-line bg-surface-raised p-6 shadow-modal"
      >
        <header className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="m-0 text-[18px] leading-[26px] font-semibold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 flex-none place-items-center rounded-button text-ink-64 hover:bg-bg-sunken hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
