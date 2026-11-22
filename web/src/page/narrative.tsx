import type { ReactNode } from "react";

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section data-block-id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Callout({ id, tone = "note", children }: { id?: string; tone?: CalloutTone; children: ReactNode }) {
  return (
    <blockquote data-callout={tone} data-block-id={id}>
      {children}
    </blockquote>
  );
}

export function Choices({ id, options }: { id?: string; options: Choice[] }) {
  return (
    <div data-block-id={id} className="mb-[18px] grid gap-3 sm:grid-cols-2">
      {options.map((option) => (
        <div
          key={option.title}
          className={`rounded-card border px-4 py-3 ${option.chosen ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-ui font-semibold text-ink">{option.title}</span>
            {option.chosen ? <span className="chip chip-accent">Chosen</span> : null}
          </div>
          {option.body ? <div className="mt-1 text-ui text-ink-64">{option.body}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function BeforeAfter({ id, before, after }: { id?: string; before: ReactNode; after: ReactNode }) {
  return (
    <div data-block-id={id} className="mb-[18px] grid gap-3 sm:grid-cols-2">
      <Panel label="Before">{before}</Panel>
      <Panel label="After">{after}</Panel>
    </div>
  );
}

export function KvTable({ id, rows }: { id?: string; rows: Record<string, ReactNode> }) {
  return (
    <div data-block-id={id} className="table-wrap">
      <table>
        <tbody>
          {Object.entries(rows).map(([key, value]) => (
            <tr key={key}>
              <td className="w-[32%] font-medium text-ink-64">{key}</td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DecisionTable({ id, rows }: { id?: string; rows: Decision[] }) {
  return (
    <div data-block-id={id} className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Decision</th>
            <th>Choice</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are static page content with no identity of their own.
            <tr key={index}>
              <td>{row.decision}</td>
              <td>{row.choice}</td>
              <td>{row.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <p className="m-0 mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-64">{label}</p>
      <div className="text-ui">{children}</div>
    </div>
  );
}

type CalloutTone = "note" | "tip" | "warning" | "caution";

interface Choice {
  title: string;
  body?: ReactNode;
  chosen?: boolean;
}

interface Decision {
  decision: ReactNode;
  choice: ReactNode;
  why: ReactNode;
}
