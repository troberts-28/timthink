import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: string;
  meta?: ReactNode;
}

export function PageHeader({ eyebrow, title, meta }: PageHeaderProps) {
  return (
    <header className="mb-8">
      {eyebrow ? <p className="m-0 mb-2 text-meta font-medium text-ink-64">{eyebrow}</p> : null}
      <h1 className="display m-0 text-page-title text-ink">{title}</h1>
      {meta ? <p className="m-0 mt-2 text-ui text-ink-64">{meta}</p> : null}
    </header>
  );
}

export function SectionHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="m-0 text-[12px] font-semibold uppercase leading-4 tracking-[0.06em] text-ink-64">{children}</h2>
      {aside ? <span className="text-meta text-ink-32">{aside}</span> : null}
    </div>
  );
}

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[960px] px-10 pt-12 pb-24">{children}</div>;
}
