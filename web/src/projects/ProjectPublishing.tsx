import { useQueryClient } from "@tanstack/react-query";
import type { PublishRecord } from "@timthink/server";
import { Copy, Globe, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { publishProject, unpublishProject } from "../api/projects";
import { queryKeys, usePublishes } from "../api/queries";
import { Button } from "../components/Button";
import { SectionHeading } from "../components/PageHeader";
import { TopBarSlot } from "../components/TopBarSlot";
import { useToast } from "../lib/toast";

const TTL_CHOICES = [
  { hours: 24, label: "1 day" },
  { hours: 7 * 24, label: "7 days" },
  { hours: 30 * 24, label: "30 days" },
] as const;
const DEFAULT_TTL_HOURS = 7 * 24;
const NO_TOKEN_COMMAND = "launchctl setenv VERCEL_TOKEN <token>";

export function PublishButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TopBarSlot>
      <Button size="sm" icon={<Globe className="size-3.5" aria-hidden />} onClick={() => setOpen(true)}>
        Publish
      </Button>
      {open ? <PublishDialog projectId={projectId} onClose={() => setOpen(false)} /> : null}
    </TopBarSlot>
  );
}

export function PublishedPages({ projectId }: { projectId: string }) {
  const { data } = usePublishes(projectId);
  const publishes = data?.publishes ?? [];
  if (publishes.length === 0) {
    return null;
  }
  return (
    <section className="mb-10">
      <SectionHeading>Published</SectionHeading>
      <ul className="m-0 list-none overflow-hidden rounded-card border border-line bg-surface p-0">
        {publishes.map((record) => (
          <PublishedRow key={record.deploymentId} projectId={projectId} record={record} />
        ))}
      </ul>
    </section>
  );
}

function PublishedRow({ projectId, record }: { projectId: string; record: PublishRecord }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const unpublish = async () => {
    setBusy(true);
    try {
      await unpublishProject(record.deploymentId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.publishes(projectId) });
      toast("Unpublished. The link no longer works.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't unpublish", "bad");
      setBusy(false);
    }
  };
  return (
    <li className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
      <Globe className="size-4 flex-none text-ink-32" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1">
        <a
          href={record.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate font-mono text-meta text-ink hover:underline"
        >
          {record.url}
        </a>
        <span className="block text-meta text-ink-64">Readable until {formatExpiry(record.expiresAt)}</span>
      </span>
      <CopyLinkButton url={record.url} />
      <Button size="sm" tone="ghost" disabled={busy} onClick={() => void unpublish()}>
        Unpublish
      </Button>
    </li>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Copied the link");
    } catch {
      toast("Couldn't copy to the clipboard", "bad");
    }
  };
  return (
    <Button size="sm" tone="ghost" icon={<Copy className="size-3.5" aria-hidden />} onClick={() => void copy()}>
      Copy link
    </Button>
  );
}

function PublishDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const titleId = useId();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data } = usePublishes(projectId);
  const [ttlHours, setTtlHours] = useState<number>(DEFAULT_TTL_HOURS);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<PublishRecord | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !publishing) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, publishing]);
  const publish = async () => {
    setPublishing(true);
    try {
      const record = await publishProject(projectId, ttlHours);
      setPublished(record);
      await queryClient.invalidateQueries({ queryKey: queryKeys.publishes(projectId) });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't publish", "bad");
    } finally {
      setPublishing(false);
    }
  };
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
            Publish this project
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
        {published ? (
          <>
            <p className="m-0 text-ui text-ink-64">
              Published until {formatExpiry(published.expiresAt)}. Vercel takes a minute to bring it up.
            </p>
            <div className="flex items-center gap-2 rounded-button border border-line bg-surface px-3 py-2">
              <a
                href={published.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate font-mono text-meta text-ink hover:underline"
              >
                {published.url}
              </a>
              <CopyLinkButton url={published.url} />
            </div>
          </>
        ) : (
          <>
            <p className="m-0 rounded-button border border-line bg-bad-soft px-3 py-2 text-ui text-ink">
              Anyone with the link can read this page until it expires: the project page, its PRs and every doc in the
              project, in full.
            </p>
            {data && !data.canPublish ? (
              <p className="m-0 text-ui text-ink-64">
                The hub has no Vercel token. Run <code className="font-mono text-meta">{NO_TOKEN_COMMAND}</code> and
                restart the hub, or run <code className="font-mono text-meta">timthink publish {projectId}</code> in a
                terminal with <code className="font-mono text-meta">VERCEL_TOKEN</code> set.
              </p>
            ) : null}
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-32">
                Readable for
              </legend>
              <div className="flex gap-2">
                {TTL_CHOICES.map((choice) => (
                  <label
                    key={choice.hours}
                    className={`flex cursor-pointer items-center gap-2 rounded-button border px-3 py-1.5 text-ui ${
                      ttlHours === choice.hours ? "border-ink-32 bg-surface text-ink" : "border-line text-ink-64"
                    }`}
                  >
                    <input
                      type="radio"
                      name="publish-ttl"
                      className="sr-only"
                      checked={ttlHours === choice.hours}
                      onChange={() => setTtlHours(choice.hours)}
                    />
                    {choice.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button tone="ghost" onClick={onClose} disabled={publishing}>
                Cancel
              </Button>
              <Button
                tone="primary"
                disabled={publishing || !data?.canPublish}
                icon={publishing ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
                onClick={() => void publish()}
              >
                {publishing ? "Publishing…" : "Publish"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatExpiry(expiresAt: string) {
  return new Date(expiresAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
