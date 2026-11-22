import { ArrowRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { MermaidDiagram } from "../markdown/MermaidDiagram";
import { useProjectFileHref } from "./projectContext";

export function Diagram({ id, caption, children }: { id?: string; caption?: string; children: ReactNode }) {
  return (
    <figure data-block-id={id} className="fence m-0 mb-[18px]">
      <div className="overflow-x-auto rounded-card border border-line-soft bg-surface p-4">{children}</div>
      {caption ? <figcaption className="mt-2 text-meta text-ink-64">{caption}</figcaption> : null}
    </figure>
  );
}

export function Mermaid({ id, code }: { id?: string; code: string }) {
  return <MermaidDiagram code={code} sourceProps={id ? { "data-block-id": id } : {}} />;
}

export function ScreenFlow({ id, before, after }: { id?: string; before?: Screen[]; after: Screen[] }) {
  return (
    <div data-block-id={id} className="mb-[18px] flex flex-col gap-4">
      {before ? <ScreenRow label="Before" screens={before} /> : null}
      <ScreenRow label={before ? "After" : null} screens={after} />
    </div>
  );
}

function ScreenRow({ label, screens }: { label: string | null; screens: Screen[] }) {
  return (
    <div>
      {label ? (
        <p className="m-0 mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-64">{label}</p>
      ) : null}
      <div className="scroll-quiet flex items-start gap-3 overflow-x-auto pb-2">
        {screens.map((screen, index) => (
          <Fragment key={screen.src}>
            {index > 0 ? <ArrowRight className="mt-24 size-4 flex-none text-ink-32" aria-hidden /> : null}
            <ScreenShot screen={screen} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function ScreenShot({ screen }: { screen: Screen }) {
  const href = useProjectFileHref(screen.src);
  return (
    <figure className="m-0 w-[180px] flex-none">
      <a href={href} target="_blank" rel="noreferrer" className="block">
        <img
          src={href}
          alt={screen.caption ?? ""}
          className="block w-full rounded-button border border-line bg-surface"
          loading="lazy"
        />
      </a>
      {screen.caption ? (
        <figcaption className="mt-1.5 text-meta leading-4 text-ink-64">{screen.caption}</figcaption>
      ) : null}
    </figure>
  );
}

interface Screen {
  src: string;
  caption?: string;
}
