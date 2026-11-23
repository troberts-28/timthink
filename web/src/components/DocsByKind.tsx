import type { DocKind, IndexedDoc } from "@timthink/server";
import { pluralise } from "../lib/format";
import { DocList } from "./DocList";
import { SectionHeading } from "./PageHeader";
import { PlanRowActions } from "./PlanRowActions";

const KIND_ORDER: DocKind[] = ["plan", "design", "research", "decision", "handoff", "notes"];

const KIND_HEADINGS: Record<DocKind, string> = {
  plan: "Plans",
  design: "Design",
  research: "Research",
  decision: "Decisions",
  handoff: "Handoffs",
  notes: "Notes",
};

export function DocsByKind({ docs }: { docs: IndexedDoc[] }) {
  return KIND_ORDER.map((kind) => <DocsOfKind key={kind} kind={kind} docs={docs.filter((doc) => doc.kind === kind)} />);
}

function DocsOfKind({ kind, docs }: { kind: DocKind; docs: IndexedDoc[] }) {
  if (docs.length === 0) {
    return null;
  }
  return (
    <section className="mb-10">
      <SectionHeading aside={pluralise(docs.length, "doc")}>{KIND_HEADINGS[kind]}</SectionHeading>
      <DocList docs={docs} actionsFor={(doc) => <PlanRowActions doc={doc} />} />
    </section>
  );
}
