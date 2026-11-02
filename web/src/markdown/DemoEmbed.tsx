import { ExternalLink } from "lucide-react";
import { rawFileHref, resolveRelative } from "../lib/routes";
import { usePlanContext } from "./PlanContext";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);
const DEFAULT_IFRAME_HEIGHT = 420;

interface DemoEmbedProps {
  attributes: Record<string, string>;
  sourceProps: Record<string, string>;
}

function extensionOf(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
}

export function DemoEmbed({ attributes, sourceProps }: DemoEmbedProps) {
  const { docPath } = usePlanContext();
  const src = attributes.src;
  const filePath = src ? resolveRelative(docPath, src) : null;
  if (!src || !filePath) {
    return (
      <p className="fence rounded-card border border-line px-4 py-3 text-ui text-ink-64" {...sourceProps}>
        This demo block needs a <code>src=</code> pointing at a file next to the plan.
      </p>
    );
  }
  const href = rawFileHref(filePath);
  const extension = extensionOf(filePath);
  const height = Number.parseInt(attributes.height ?? "", 10) || DEFAULT_IFRAME_HEIGHT;

  return (
    <figure className="fence m-0 overflow-hidden rounded-card border border-line bg-surface" {...sourceProps}>
      <figcaption className="flex items-center gap-2 border-b border-line-soft bg-bg-sunken px-4 py-2 text-meta text-ink-64">
        <span className="font-semibold uppercase tracking-[0.04em]">Demo</span>
        <span className="truncate font-mono">{src}</span>
        <a
          className="ml-auto inline-flex items-center gap-1 no-underline hover:text-ink"
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          Open <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </figcaption>
      {IMAGE_EXTENSIONS.has(extension) ? (
        <img className="block w-full rounded-none border-0" src={href} alt={src} />
      ) : VIDEO_EXTENSIONS.has(extension) ? (
        // biome-ignore lint/a11y/useMediaCaption: demo recordings have no caption track.
        <video className="block w-full" src={href} controls />
      ) : (
        <iframe
          className="block w-full border-0 bg-surface"
          src={href}
          title={`Demo: ${src}`}
          sandbox="allow-scripts"
          style={{ height }}
        />
      )}
    </figure>
  );
}
