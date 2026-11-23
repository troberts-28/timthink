import { type FormEvent, useState } from "react";
import { useToast } from "../lib/toast";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface RenameDialogProps {
  heading: string;
  currentTitle: string;
  hint: string;
  rename: (title: string) => Promise<void>;
  onClose: () => void;
}

export function RenameDialog({ heading, currentTitle, hint, rename, onClose }: RenameDialogProps) {
  const toast = useToast();
  const [title, setTitle] = useState(currentTitle);
  const [saving, setSaving] = useState(false);
  const unchanged = title.trim() === currentTitle.trim();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (unchanged || title.trim() === "") {
      return;
    }
    setSaving(true);
    try {
      await rename(title.trim());
      toast("Renamed.");
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't rename it", "bad");
      setSaving(false);
    }
  };
  return (
    <Dialog title={heading} onClose={onClose} busy={saving}>
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={(event) => event.target.select()}
          aria-label="Title"
          maxLength={200}
          className="field text-[15px]"
        />
        <p className="m-0 text-meta text-ink-64">{hint}</p>
        <div className="flex justify-end gap-2">
          <Button tone="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" tone="primary" disabled={saving || unchanged || title.trim() === ""}>
            Rename
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
