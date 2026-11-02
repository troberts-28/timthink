import type { ThreadKind } from "@timthink/server";
import { MessageSquare, PencilLine } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Button } from "../components/Button";
import { type ComposerRequest, useRequiredReview } from "./ReviewContext";
import { excerpt } from "./reviewModel";
import { SuggestionDiff } from "./SuggestionDiff";

export const COMPOSER_WIDTH_PX = 400;

const MODES: ReadonlyArray<{ kind: ThreadKind; label: string; Icon: typeof MessageSquare }> = [
  { kind: "comment", label: "Comment", Icon: MessageSquare },
  { kind: "suggestion", label: "Suggest edit", Icon: PencilLine },
];

interface ComposerProps {
  request: ComposerRequest;
  position: { top: number; left: number };
}

export function Composer({ request, position }: ComposerProps) {
  const { raw, actions, closeComposer } = useRequiredReview();
  const original = raw.slice(request.start, request.end);
  const [kind, setKind] = useState<ThreadKind>(request.kind);
  const [body, setBody] = useState(request.initialBody ?? "");
  const [suggestion, setSuggestion] = useState(request.initialSuggestion ?? original);
  const [saving, setSaving] = useState(false);
  const isSuggestion = kind === "suggestion";
  const unchanged = isSuggestion && suggestion === original;
  const canSave = !saving && (isSuggestion ? !unchanged : body.trim().length > 0);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const ok = await actions.createThread({
      kind,
      start: request.start,
      end: request.end,
      body,
      suggestion: isSuggestion ? suggestion : null,
    });
    setSaving(false);
    if (ok) closeComposer();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeComposer();
    }
  };

  return (
    <div
      role="dialog"
      aria-label={isSuggestion ? "Suggest an edit" : "Add a comment"}
      className="composer popover-enter absolute z-30 flex flex-col gap-3 rounded-card border border-line bg-surface-raised p-3.5 shadow-pop"
      style={{ top: position.top, left: position.left, width: COMPOSER_WIDTH_PX }}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-2">
        <div className="segmented" role="tablist" aria-label="Kind">
          {MODES.map(({ kind: mode, label, Icon }) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={kind === mode}
              onClick={() => setKind(mode)}
              className="segmented-item"
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto min-w-0 truncate text-meta text-ink-32" title={original}>
          {excerpt(original, 28)}
        </span>
      </div>
      {isSuggestion ? (
        <>
          <textarea
            // biome-ignore lint/a11y/noAutofocus: the composer opens on an explicit action.
            autoFocus
            rows={Math.min(8, Math.max(2, suggestion.split("\n").length + 1))}
            value={suggestion}
            onChange={(event) => setSuggestion(event.target.value)}
            aria-label="Replacement markdown"
            spellCheck
            className="field font-mono text-[12.5px] leading-[1.55]"
          />
          <div className="rounded-button bg-bg px-3 py-2">
            <p className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-32">Preview</p>
            {unchanged ? (
              <p className="m-0 text-meta text-ink-32">Edit the markdown above to suggest a change.</p>
            ) : (
              <SuggestionDiff before={original} after={suggestion} />
            )}
          </div>
          <textarea
            rows={2}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Why? (optional)"
            className="field text-[13.5px]"
          />
        </>
      ) : (
        <textarea
          // biome-ignore lint/a11y/noAutofocus: the composer opens on an explicit action.
          autoFocus
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Leave a comment"
          className="field text-[14px]"
        />
      )}
      <div className="flex items-center gap-2">
        <span className="text-meta text-ink-32">
          <kbd className="kbd">⌘</kbd>
          <kbd className="kbd">↵</kbd> to add
        </span>
        <div className="ml-auto flex gap-1.5">
          <Button tone="ghost" onClick={closeComposer}>
            Cancel
          </Button>
          <Button tone="primary" disabled={!canSave} onClick={() => void save()}>
            Add to review
          </Button>
        </div>
      </div>
    </div>
  );
}
