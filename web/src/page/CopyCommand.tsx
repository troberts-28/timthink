import { CopyCommandButton } from "../components/CopyCommandButton";

export function CopyCommand({ id, command }: { id?: string; command: string }) {
  return (
    <div
      data-block-id={id}
      className="mb-[18px] flex items-center gap-2 rounded-button border border-line-soft bg-bg-sunken py-1 pr-1 pl-3"
    >
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[13px]">{command}</code>
      <CopyCommandButton command={command} label="Copy command" />
    </div>
  );
}
