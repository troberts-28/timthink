import type { AttachmentSummary } from "@timthink/server";
import { File, FileCode, FileText, Image } from "lucide-react";
import { useState } from "react";
import { useAttachments } from "../api/queries";
import { fileSize } from "../lib/format";
import { rawFileHref } from "../lib/routes";

const COLLAPSED_LIMIT = 8;

function iconFor(type: string) {
  if (type.startsWith("image/")) return Image;
  if (type.includes("json") || type.includes("javascript") || type.includes("html")) return FileCode;
  if (type.startsWith("text/") || type === "application/pdf") return FileText;
  return File;
}

function extensionLabel(relPath: string): string {
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "FILE";
}

interface AttachmentListProps {
  attachments: AttachmentSummary[];
  stripPrefix?: string;
  limit?: number;
}

export function AttachmentList({ attachments, stripPrefix = "", limit = COLLAPSED_LIMIT }: AttachmentListProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? attachments : attachments.slice(0, limit);
  const hidden = attachments.length - visible.length;
  return (
    <div>
      <ul className="m-0 list-none p-0">
        {visible.map((attachment) => {
          const Icon = iconFor(attachment.type);
          const label = attachment.relPath.startsWith(stripPrefix)
            ? attachment.relPath.slice(stripPrefix.length)
            : attachment.relPath;
          return (
            <li key={attachment.path} className="border-b border-line-soft last:border-b-0">
              <a
                href={rawFileHref(attachment.path)}
                target="_blank"
                rel="noreferrer"
                className="grid grid-cols-[16px_minmax(0,1fr)_auto_64px] items-center gap-3 py-2 text-ui text-ink no-underline hover:text-info-ink"
              >
                <Icon className="size-4 text-ink-32" strokeWidth={1.75} aria-hidden />
                <span className="truncate font-mono text-[12.5px]" title={attachment.relPath}>
                  {label}
                </span>
                <span className="text-[11px] font-medium tracking-[0.04em] text-ink-32">
                  {extensionLabel(attachment.relPath)}
                </span>
                <span className="text-right text-meta text-ink-64 tabular-nums">{fileSize(attachment.size)}</span>
              </a>
            </li>
          );
        })}
      </ul>
      {hidden > 0 || expanded ? (
        <button
          type="button"
          className="mt-2 rounded-button px-2 py-1 text-meta font-medium text-ink-64 hover:bg-bg-sunken hover:text-ink"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show fewer" : `Show ${hidden} more`}
        </button>
      ) : null}
    </div>
  );
}

export function FilesCard({ repo, project }: { repo: string; project: string | null }) {
  const { data: attachments } = useAttachments(repo, project);
  return (
    <div className="rounded-card border border-line bg-surface px-5 py-2">
      {attachments ? (
        <AttachmentList attachments={attachments} stripPrefix={project ? `${project}/` : ""} limit={24} />
      ) : (
        <div className="h-24 animate-pulse" aria-hidden />
      )}
    </div>
  );
}
