import { X } from "lucide-react";
import { useEffect, useId } from "react";

interface Shortcut {
  keys: string[];
  action: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Getting around",
    shortcuts: [
      { keys: ["⌘", "K"], action: "Jump to any plan or repo" },
      { keys: ["j"], action: "Next plan" },
      { keys: ["k"], action: "Previous plan" },
      { keys: ["u"], action: "Up a level" },
      { keys: ["i"], action: "Go to the inbox" },
      { keys: ["["], action: "Show or hide the sidebar" },
      { keys: ["?"], action: "Show these shortcuts" },
    ],
  },
  {
    title: "Reviewing a plan",
    shortcuts: [
      { keys: ["c"], action: "Comment on the selected text" },
      { keys: ["s"], action: "Suggest an edit to the selected text" },
      { keys: ["n"], action: "Next open thread" },
      { keys: ["p"], action: "Previous open thread" },
      { keys: ["r"], action: "Submit review" },
      { keys: ["a"], action: "Approve (opens Submit review)" },
    ],
  },
  {
    title: "On a plan",
    shortcuts: [
      { keys: ["w"], action: "Jump to its Claude session in Warp" },
      { keys: ["d"], action: "Show or hide changes since you last looked" },
      { keys: ["y"], action: "Copy the markdown" },
      { keys: ["e"], action: "Archive or restore" },
    ],
  },
  {
    title: "While writing",
    shortcuts: [
      { keys: ["⌘", "↵"], action: "Add the comment, send the reply or submit the review" },
      { keys: ["Esc"], action: "Close the composer, menu or dialog" },
    ],
  },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop fixed inset-0 z-50 grid place-items-center p-6" role="presentation">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog-panel relative flex w-[min(460px,100%)] flex-col gap-5 rounded-card border border-line bg-surface-raised p-6 shadow-modal"
      >
        <header className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="m-0 text-[18px] leading-[26px] font-semibold text-ink">
            Keyboard shortcuts
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
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <h3 className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-32">{group.title}</h3>
            <dl className="m-0 flex flex-col gap-1.5">
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.action} className="flex items-center justify-between gap-4 text-ui">
                  <dt className="text-ink-64">{shortcut.action}</dt>
                  <dd className="m-0 flex flex-none gap-1">
                    {shortcut.keys.map((key) => (
                      <kbd key={key} className="kbd">
                        {key}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
