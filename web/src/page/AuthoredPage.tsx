import type { PageBuildError, ProjectDetail } from "@timthink/server";
import * as React from "react";
import { Component, type ComponentType, type ErrorInfo, type ReactNode, useMemo } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { useProjectPage } from "../api/queries";
import * as pageApi from "./index";
import { ProjectContext } from "./projectContext";

const PAGE_MODULES: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "timthink/page": pageApi,
};

export function AuthoredPage({ detail }: { detail: ProjectDetail }) {
  const { data: page } = useProjectPage(detail.project.id);
  if (!page || page.kind === "none") {
    return null;
  }
  if (page.kind === "failed") {
    return (
      <PageProblem title="project.page.tsx doesn't compile">
        {page.errors.map((error) => `${errorLocation(error)}${error.message}`).join("\n")}
      </PageProblem>
    );
  }
  return (
    <BuiltPage
      code={`${page.code}\n//# sourceURL=${detail.project.id}/project.page.tsx`}
      hash={page.hash}
      detail={detail}
    />
  );
}

function BuiltPage({ code, hash, detail }: { code: string; hash: string; detail: ProjectDetail }) {
  const loaded = useMemo(() => loadPage(code), [code]);
  if (loaded.kind === "broken") {
    return <PageProblem title="project.page.tsx failed to load">{loaded.message}</PageProblem>;
  }
  const { Page } = loaded;
  return (
    <PageErrorBoundary key={hash}>
      <ProjectContext.Provider value={detail}>
        <div className="plan-body mb-12">
          <Page />
        </div>
      </ProjectContext.Provider>
    </PageErrorBoundary>
  );
}

type LoadedPage = { kind: "loaded"; Page: ComponentType } | { kind: "broken"; message: string };

function loadPage(code: string): LoadedPage {
  const pageModule: { exports: Record<string, unknown> } = { exports: {} };
  try {
    new Function("require", "module", "exports", code)(requirePageModule, pageModule, pageModule.exports);
  } catch (error) {
    return { kind: "broken", message: errorText(error) };
  }
  const Page = pageModule.exports.default;
  return isComponent(Page)
    ? { kind: "loaded", Page }
    : { kind: "broken", message: "The page has no default export. Export the page component as default." };
}

function requirePageModule(name: string) {
  const found = PAGE_MODULES[name];
  if (found === undefined) {
    throw new Error(`Pages can import react, timthink/page and relative files, not "${name}"`);
  }
  return found;
}

function isComponent(value: unknown): value is ComponentType {
  return typeof value === "function";
}

interface RenderFailure {
  message: string;
  componentStack: string;
}

class PageErrorBoundary extends Component<{ children: ReactNode }, { failure: RenderFailure | null }> {
  override state: { failure: RenderFailure | null } = { failure: null };

  static getDerivedStateFromError(error: unknown) {
    return { failure: { message: errorText(error), componentStack: "" } };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState({ failure: { message: errorText(error), componentStack: pageFrames(info.componentStack ?? "") } });
  }

  override render() {
    const { failure } = this.state;
    if (!failure) {
      return this.props.children;
    }
    return (
      <PageProblem title="project.page.tsx failed to render">
        {[failure.message, failure.componentStack.trim()].filter(Boolean).join("\n\n")}
      </PageProblem>
    );
  }
}

function pageFrames(componentStack: string) {
  const lines = componentStack.split("\n");
  const boundary = lines.findIndex((line) => line.includes(PageErrorBoundary.name));
  return (boundary === -1 ? lines : lines.slice(0, boundary)).join("\n");
}

function PageProblem({ title, children }: { title: string; children: string }) {
  return (
    <div className="mb-10 rounded-card border border-bad/40 bg-bad-soft px-4 py-3 text-ui">
      <p className="m-0 font-medium text-bad-ink">{title}</p>
      <pre className="mt-2 mb-0 whitespace-pre-wrap font-mono text-meta text-ink-64">{children}</pre>
    </div>
  );
}

function errorLocation(error: PageBuildError) {
  if (!error.file) {
    return "";
  }
  return `${error.file}${error.line === null ? "" : `:${error.line}:${(error.column ?? 0) + 1}`}: `;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
