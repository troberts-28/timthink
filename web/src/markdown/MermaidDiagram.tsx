import { Maximize2, X } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../lib/theme";
import { type SvgSize, svgNaturalSize, withoutFixedSize } from "./mermaidSize";
import { mermaidThemeVariables } from "./mermaidTheme";

const MAX_UPSCALE = 1.4;
const MODAL_MAX_UPSCALE = 2;
const READABLE_SCALE = 0.85;
const INLINE_CONTENT_WIDTH = 610;

let renderQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = renderQueue.then(task, task);
  renderQueue = next.catch(() => {});
  return next;
}

async function renderMermaid(id: string, code: string, isDark: boolean): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: mermaidThemeVariables(isDark),
    flowchart: { curve: "basis", padding: 14, htmlLabels: true },
  });
  const { svg } = await mermaid.render(id, code);
  return svg;
}

interface MermaidDiagramProps {
  code: string;
  sourceProps: Record<string, string>;
}

export function MermaidDiagram({ code, sourceProps }: MermaidDiagramProps) {
  const { effective } = useTheme();
  const reactId = useId();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, "")}-${effective}`;
    enqueue(() => renderMermaid(id, code, effective === "dark"))
      .then((result) => {
        if (cancelled) return;
        setSvg(result);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not render diagram");
      });
    return () => {
      cancelled = true;
    };
  }, [code, effective, reactId]);

  if (error) {
    return (
      <div className="fence rounded-card border border-bad/40 bg-bad-soft px-4 py-3 text-ui" {...sourceProps}>
        <p className="m-0 font-medium text-bad-ink">Mermaid diagram failed to render</p>
        <pre className="mt-2 mb-0 whitespace-pre-wrap font-mono text-meta text-ink-64">{error}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <figure className="fence mermaid-figure" {...sourceProps} aria-busy>
        <div className="h-40 w-full animate-pulse rounded-button bg-bg-sunken" />
      </figure>
    );
  }
  return <RenderedDiagram svg={svg} sourceProps={sourceProps} />;
}

function inlineStyle(size: SvgSize | null): CSSProperties | undefined {
  if (!size) return undefined;
  return { maxWidth: `${Math.round(size.width * MAX_UPSCALE)}px`, aspectRatio: `${size.width} / ${size.height}` };
}

function RenderedDiagram({ svg, sourceProps }: { svg: string; sourceProps: Record<string, string> }) {
  const [expanded, setExpanded] = useState(false);
  const size = svgNaturalSize(svg);
  const fluidSvg = withoutFixedSize(svg);
  const cramped = size !== null && INLINE_CONTENT_WIDTH / size.width < READABLE_SCALE;
  return (
    <figure className={`fence mermaid-figure group ${cramped ? "is-cramped" : ""}`} {...sourceProps}>
      <button
        type="button"
        className="mermaid-canvas"
        onClick={() => setExpanded(true)}
        aria-label="Expand diagram"
        title="Expand diagram"
      >
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid output is sanitised with securityLevel "strict". */}
        <span className="mermaid-svg" style={inlineStyle(size)} dangerouslySetInnerHTML={{ __html: fluidSvg }} />
      </button>
      <span className="mermaid-expand-hint" aria-hidden>
        <Maximize2 className="size-3" />
        {cramped ? "Click to expand" : "Expand"}
      </span>
      {expanded ? <DiagramModal svg={fluidSvg} size={size} onClose={() => setExpanded(false)} /> : null}
    </figure>
  );
}

function DiagramModal({ svg, size, onClose }: { svg: string; size: SvgSize | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const style: CSSProperties | undefined = size
    ? { maxWidth: `${Math.round(size.width * MODAL_MAX_UPSCALE)}px`, aspectRatio: `${size.width} / ${size.height}` }
    : undefined;
  return createPortal(
    <div className="mermaid-modal-backdrop">
      <button
        type="button"
        className="mermaid-modal-dismiss"
        onClick={onClose}
        aria-label="Close diagram"
        tabIndex={-1}
      />
      <div role="dialog" aria-modal="true" aria-label="Diagram" className="mermaid-modal">
        <button
          ref={closeRef}
          type="button"
          className="mermaid-modal-close"
          onClick={onClose}
          aria-label="Close diagram"
        >
          <X className="size-4" aria-hidden />
        </button>
        <div className="mermaid-modal-scroll scroll-quiet">
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid output is sanitised with securityLevel "strict". */}
          <div className="mermaid-svg" style={style} dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
