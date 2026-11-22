import type { DocKind, ExportDoc, ProjectActivity, ProjectExport, ProjectPr } from "@timthink/server";
import { parseInfoString, parseQuestionBlock } from "@timthink/server/shared";
import type { Components } from "hast-util-to-jsx-runtime";
import { ArrowLeft } from "lucide-react";
import {
  Children,
  type ComponentProps,
  type ComponentType,
  isValidElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { PageContainer, PageHeader, SectionHeading } from "../components/PageHeader";
import { longDate, pluralise, relativeTime } from "../lib/format";
import { resolveRelative } from "../lib/routes";
import { dataAttribute, hastToReact } from "../markdown/hastToReact";
import { MermaidDiagram } from "../markdown/MermaidDiagram";
import { markdownToHast } from "../markdown/pipeline";
import { PR_STATE_LABELS, PrStateDot } from "../prs/PrVisuals";

const DOC_ROUTE = "#/doc/";
const HUB_DOC_ROUTE = "/d/";
const EXTERNAL_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

const KIND_ORDER: DocKind[] = ["plan", "design", "research", "decision", "handoff", "notes"];
const KIND_HEADINGS: Record<DocKind, string> = {
  plan: "Plans",
  design: "Design",
  research: "Research",
  decision: "Decisions",
  handoff: "Handoffs",
  notes: "Notes",
};

const ACTIVITY_VERBS: Record<ProjectActivity["kind"], string> = {
  "doc-updated": "Updated",
  "review-submitted": "Reviewed",
  "review-addressed": "Addressed the review of",
  "pr-merged": "Merged",
  "pr-closed": "Closed",
  "pr-updated": "Updated",
};

export function exportFileHref(filePath: string) {
  return `files/${filePath.split("/").map(encodeURIComponent).join("/")}`;
}

export function ExportApp({ data, Page }: { data: ProjectExport; Page: ComponentType | null }) {
  const openDocPath = useOpenDocPath();
  const openDoc = data.docs.find((doc) => doc.path === openDocPath);
  useEffect(() => {
    document.title = openDoc ? `${openDoc.title} · ${data.detail.project.title}` : data.detail.project.title;
    window.scrollTo(0, 0);
  }, [openDoc, data.detail.project.title]);
  return (
    <main className="min-h-screen bg-bg text-ink">
      {openDoc ? <DocView data={data} doc={openDoc} /> : <Overview data={data} Page={Page} />}
    </main>
  );
}

function useOpenDocPath() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return hash.startsWith(DOC_ROUTE) ? decodeURIComponent(hash.slice(DOC_ROUTE.length)) : null;
}

function docRoute(docPath: string) {
  return `${DOC_ROUTE}${encodeURIComponent(docPath)}`;
}

function Overview({ data, Page }: { data: ProjectExport; Page: ComponentType | null }) {
  const { project, area, prs, activity } = data.detail;
  return (
    <PageContainer>
      <PageHeader eyebrow={area?.title ?? "Project"} title={project.title} meta={<PublishedMeta data={data} />} />
      {project.summary ? (
        <p className="m-0 -mt-4 mb-8 max-w-[72ch] text-[16px] leading-[1.6] text-ink-64">{project.summary}</p>
      ) : null}
      {Page ? (
        <div className="plan-body mb-12">
          <Page />
        </div>
      ) : null}
      {prs.stacks.length > 0 ? (
        <section className="mb-10">
          <SectionHeading>Pull requests</SectionHeading>
          {prs.stacks.map((stack) => (
            <ul
              key={stack.prs.map((pr) => `${pr.repo}#${pr.number}`).join(",")}
              className="m-0 mb-3 list-none overflow-hidden rounded-card border border-line bg-surface p-0"
            >
              {stack.prs.map((pr) => (
                <PrRow key={`${pr.repo}#${pr.number}`} pr={pr} />
              ))}
            </ul>
          ))}
        </section>
      ) : null}
      {KIND_ORDER.map((kind) => (
        <DocsOfKind key={kind} kind={kind} docs={data.docs.filter((doc) => doc.kind === kind)} />
      ))}
      {activity.length > 0 ? (
        <section className="mb-10">
          <SectionHeading>Activity</SectionHeading>
          <ol className="m-0 list-none p-0">
            {activity.map((entry) => (
              <ActivityRow key={`${entry.kind}:${entry.at}:${entry.docPath ?? entry.pr?.number}`} entry={entry} />
            ))}
          </ol>
        </section>
      ) : null}
    </PageContainer>
  );
}

function PublishedMeta({ data }: { data: ProjectExport }) {
  return (
    <span>
      Published {longDate(isoDay(data.publishedAt))} · readable until {longDate(isoDay(data.expiresAt))}
    </span>
  );
}

function isoDay(timestamp: string) {
  return timestamp.slice(0, "YYYY-MM-DD".length);
}

function PrRow({ pr }: { pr: ProjectPr }) {
  const { info } = pr;
  return (
    <li className="flex items-start gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
      <PrStateDot state={info?.state ?? null} className="mt-1.5" />
      <span className="min-w-0">
        {info ? (
          <a
            href={info.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-ui text-ink hover:underline"
          >
            <span className="text-ink-32 tabular-nums">#{pr.number}</span> {info.title}
          </a>
        ) : (
          <span className="block text-ui text-ink">
            {pr.repo}#{pr.number}
          </span>
        )}
        {info ? <span className="block text-meta text-ink-64">{PR_STATE_LABELS[info.state]}</span> : null}
      </span>
    </li>
  );
}

function DocsOfKind({ kind, docs }: { kind: DocKind; docs: ExportDoc[] }) {
  if (docs.length === 0) {
    return null;
  }
  return (
    <section className="mb-10">
      <SectionHeading aside={pluralise(docs.length, "doc")}>{KIND_HEADINGS[kind]}</SectionHeading>
      <ul className="m-0 list-none overflow-hidden rounded-card border border-line bg-surface p-0">
        {docs.map((doc) => (
          <li key={doc.path} className="border-b border-line-soft last:border-b-0">
            <a
              href={docRoute(doc.path)}
              className="flex items-baseline gap-3 px-4 py-3 transition-colors duration-150 hover:bg-bg/60"
            >
              <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">{doc.title}</span>
              {doc.status ? <span className="chip chip-neutral flex-none">{doc.status}</span> : null}
              {doc.date ? <span className="flex-none text-meta text-ink-32 tabular-nums">{doc.date}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivityRow({ entry }: { entry: ProjectActivity }) {
  const subject = entry.pr ? `#${entry.pr.number} ${entry.title}` : entry.title;
  return (
    <li className="flex items-baseline gap-3 py-1.5 text-ui">
      <time dateTime={entry.at} className="w-20 flex-none text-meta text-ink-32 tabular-nums">
        {relativeTime(Date.parse(entry.at))}
      </time>
      <span className="min-w-0 truncate text-ink-64">
        {ACTIVITY_VERBS[entry.kind]}{" "}
        {entry.docPath ? (
          <a href={docRoute(entry.docPath)} className="text-ink hover:underline">
            {subject}
          </a>
        ) : entry.pr ? (
          <a href={entry.pr.url} target="_blank" rel="noreferrer" className="text-ink hover:underline">
            {subject}
          </a>
        ) : (
          <span className="text-ink">{subject}</span>
        )}
      </span>
    </li>
  );
}

function DocView({ data, doc }: { data: ProjectExport; doc: ExportDoc }) {
  const body = useMemo(() => renderDoc(data, doc), [data, doc]);
  return (
    <PageContainer>
      <a href="#/" className="mb-6 inline-flex items-center gap-1.5 text-meta text-ink-64 hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden />
        {data.detail.project.title}
      </a>
      <PageHeader eyebrow={KIND_HEADINGS[doc.kind]} title={doc.title} meta={doc.date ?? undefined} />
      <article className="plan-body">{body}</article>
    </PageContainer>
  );
}

function renderDoc(data: ProjectExport, doc: ExportDoc): ReactNode {
  const repoLink = data.detail.repoLinks[doc.codeRepo];
  const { hast } = markdownToHast(doc.raw, {
    github: repoLink?.github ?? null,
    prLinks: repoLink?.prLinks ?? "github",
    docPath: doc.path,
    repoDocPaths: data.docs.map((entry) => entry.path),
  });
  return hastToReact(hast, docComponents(doc.path));
}

function docComponents(docPath: string): Partial<Components> {
  return {
    a: ({ href, ...props }: ComponentProps<"a">) => <a {...props} href={exportHref(docPath, href)} />,
    img: ({ src, ...props }: ComponentProps<"img">) => (
      <img {...props} alt={props.alt ?? ""} src={fileSrc(docPath, src)} />
    ),
    div: (props: ComponentProps<"div">) => {
      const lang = dataAttribute(props, "data-fence");
      return lang === undefined ? <div {...props} /> : <ExportFence lang={lang} {...props} />;
    },
  };
}

function exportHref(docPath: string, href: string | undefined) {
  if (!href || href.startsWith("#") || EXTERNAL_URL.test(href)) {
    return href;
  }
  if (href.startsWith(HUB_DOC_ROUTE)) {
    return docRoute(decodeURIComponent(href.slice(HUB_DOC_ROUTE.length)));
  }
  const [target = "", anchor] = href.split("#");
  const resolved = resolveRelative(docPath, decodeURIComponent(target));
  if (!resolved) {
    return href;
  }
  return resolved.endsWith(".md") ? docRoute(resolved) : exportFileHref(resolved) + (anchor ? `#${anchor}` : "");
}

function fileSrc(docPath: string, src: string | undefined) {
  if (!src || EXTERNAL_URL.test(src) || src.startsWith("data:")) {
    return src;
  }
  const resolved = resolveRelative(docPath, decodeURIComponent(src));
  return resolved ? exportFileHref(resolved) : src;
}

function ExportFence({ lang, ...props }: ComponentProps<"div"> & { lang: string }) {
  const children = Children.toArray(props.children);
  const code = children
    .filter((child) => typeof child === "string")
    .join("")
    .replace(/\n$/, "");
  if (lang === "mermaid") {
    return <MermaidDiagram code={code} sourceProps={{}} />;
  }
  if (lang === "question") {
    const question = parseQuestionBlock(code, parseInfoString(dataAttribute(props, "data-meta") ?? ""));
    return (
      <div className="mb-[18px] rounded-card border border-line bg-surface px-4 py-3">
        <p className="m-0 font-medium text-ink">{question.prompt}</p>
        <ul className="m-0 mt-2 pl-5">
          {question.options.map((option) => (
            <li key={option.label}>
              {option.label}
              {option.recommended ? <span className="chip chip-accent ml-2">Recommended</span> : null}
              {option.summary ? <span className="block text-meta text-ink-64">{option.summary}</span> : null}
            </li>
          ))}
        </ul>
        {children.filter(isValidElement)}
      </div>
    );
  }
  return (
    <pre className="mb-[18px] overflow-x-auto rounded-card border border-line-soft bg-surface p-4 font-mono text-meta">
      <code>{code}</code>
    </pre>
  );
}
