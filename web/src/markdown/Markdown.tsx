import { parseInfoString } from "@timthink/server/shared";
import type { Element, Root } from "hast";
import type { Components } from "hast-util-to-jsx-runtime";
import { Children, type ComponentProps, createElement, isValidElement, memo, type ReactNode } from "react";
import { Link } from "react-router";
import { RemovedGhost } from "../changes/RemovedGhost";
import { docHref, rawFileHref, resolveRelative } from "../lib/routes";
import { PrLink } from "../prs/PrLink";
import { SectionMenu } from "../review/SectionMenu";
import { CodeBlock } from "./CodeBlock";
import { CodeRef } from "./CodeRef";
import { DemoEmbed } from "./DemoEmbed";
import { dataAttribute, hastToReact, sourceAttributes } from "./hastToReact";
import { MermaidDiagram } from "./MermaidDiagram";
import { usePlanContext } from "./PlanContext";
import { QuestionCard } from "./QuestionCard";

const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function textOf(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(textOf).join("");
  return "";
}

function numericAttribute(props: object, name: string): number | null {
  const value = dataAttribute(props, name);
  return value === undefined ? null : Number(value);
}

function detailsRange(props: object): { start: number; end: number } | null {
  const start = numericAttribute(props, "data-details-start");
  const end = numericAttribute(props, "data-details-end");
  return start !== null && end !== null ? { start, end } : null;
}

function QuestionFence({ meta, ...props }: ComponentProps<"div"> & { meta: string }) {
  const children = Children.toArray(props.children);
  const code = textOf(children.filter((child) => typeof child === "string")).replace(/\n$/, "");
  const details = children.filter(isValidElement);
  return (
    <QuestionCard
      code={code}
      attributes={parseInfoString(meta)}
      sourceProps={sourceAttributes(props)}
      details={details.length > 0 ? details : null}
      detailsRange={detailsRange(props)}
    />
  );
}

function Fence(props: ComponentProps<"div">) {
  const lang = dataAttribute(props, "data-fence") ?? "";
  const meta = dataAttribute(props, "data-meta") ?? "";
  if (lang === "question") return <QuestionFence meta={meta} {...props} />;
  const code = textOf(props.children).replace(/\n$/, "");
  const sourceProps = sourceAttributes(props);
  if (lang === "mermaid") return <MermaidDiagram code={code} sourceProps={sourceProps} />;
  if (lang === "demo") return <DemoEmbed attributes={parseInfoString(meta)} sourceProps={sourceProps} />;
  return (
    <CodeBlock
      code={code}
      lang={lang}
      sourceProps={sourceProps}
      contentStart={numericAttribute(props, "data-cs")}
      contentEnd={numericAttribute(props, "data-ce")}
    />
  );
}

function Div(props: ComponentProps<"div">) {
  if (dataAttribute(props, "data-fence") !== undefined) return <Fence {...props} />;
  return <div {...props} />;
}

function Code(props: ComponentProps<"code">) {
  const codeRef = dataAttribute(props, "data-code-ref");
  if (codeRef) {
    return (
      <CodeRef value={codeRef} sourceProps={sourceAttributes(props)}>
        {props.children}
      </CodeRef>
    );
  }
  return <code {...props} />;
}

function Anchor({ href, children, ...rest }: ComponentProps<"a">) {
  const { docPath } = usePlanContext();
  if (!href || href.startsWith("#"))
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  if (href.startsWith("/")) {
    return (
      <Link to={href} {...rest}>
        {children}
      </Link>
    );
  }
  if ("data-pr" in rest) {
    return (
      <PrLink href={href} {...rest}>
        {children}
      </PrLink>
    );
  }
  if (EXTERNAL_SCHEME.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  const [target = "", hash = ""] = href.split("#");
  const resolved = resolveRelative(docPath, decodeURIComponent(target));
  if (!resolved) return <span {...rest}>{children}</span>;
  if (resolved.toLowerCase().endsWith(".md")) {
    return (
      <Link to={`${docHref(resolved)}${hash ? `#${hash}` : ""}`} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={rawFileHref(resolved)} target="_blank" rel="noreferrer" {...rest}>
      {children}
    </a>
  );
}

function Image({ src, alt, ...rest }: ComponentProps<"img">) {
  const { docPath } = usePlanContext();
  const resolved = src && !EXTERNAL_SCHEME.test(src) && !src.startsWith("/") ? resolveRelative(docPath, src) : null;
  return <img src={resolved ? rawFileHref(resolved) : src} alt={alt ?? ""} loading="lazy" {...rest} />;
}

function Table(props: ComponentProps<"table">) {
  return (
    <div className="table-wrap">
      <table {...props} />
    </div>
  );
}

type HeadingTag = "h2" | "h3" | "h4";

function Heading({ tag, children, ...props }: ComponentProps<HeadingTag> & { tag: HeadingTag }) {
  const start = numericAttribute(props, "data-s");
  const end = numericAttribute(props, "data-section-end");
  const menu = start !== null && end !== null ? <SectionMenu start={start} end={end} /> : null;
  return createElement(tag, props, children, menu);
}

function H2(props: ComponentProps<"h2">) {
  return <Heading tag="h2" {...props} />;
}

function H3(props: ComponentProps<"h3">) {
  return <Heading tag="h3" {...props} />;
}

function H4(props: ComponentProps<"h4">) {
  return <Heading tag="h4" {...props} />;
}

function Aside(props: ComponentProps<"aside">) {
  const ghost = dataAttribute(props, "data-diff-ghost");
  if (ghost) return <RemovedGhost id={ghost} />;
  return <aside {...props} />;
}

const components: Partial<Components> = {
  aside: Aside,
  div: Div,
  code: Code,
  a: Anchor,
  img: Image,
  table: Table,
  h2: H2,
  h3: H3,
  h4: H4,
};

export const MarkdownBody = memo(function MarkdownBody({ hast }: { hast: Root }) {
  return <div className="plan-body">{hastToReact(hast, components)}</div>;
});

export const MarkdownElement = memo(function MarkdownElement({ element }: { element: Element }) {
  return hastToReact({ type: "root", children: [element] }, components);
});
