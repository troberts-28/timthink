import type { AreaDetail, AuthoredPageView, PageBuildError, ProjectDetail } from "@timthink/server";
import { AREA_PAGE_FILE, PROJECT_PAGE_FILE } from "@timthink/server/shared";
import * as React from "react";
import { Component, type ComponentType, type ErrorInfo, type ReactNode, useMemo } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { useAreaPage, useProjectPage } from "../api/queries";
import { ReviewProvider } from "../review/ReviewContext";
import * as pageApi from "./index";
import { CommentableBlocks, PageThreads } from "./PageComments";
import {
  AreaContext,
  areaPageScope,
  type PageScope,
  PageScopeContext,
  ProjectContext,
  projectPageScope,
} from "./projectContext";

const PAGE_MODULES: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "timthink/page": pageApi,
};

export function ProjectAuthoredPage({ detail }: { detail: ProjectDetail }) {
  const { data: view } = useProjectPage(detail.project.id);
  const scope = projectPageScope(detail, `${detail.project.id}/${PROJECT_PAGE_FILE}`);
  return (
    <ProjectContext.Provider value={detail}>
      <AuthoredPage view={view} scope={scope} />
    </ProjectContext.Provider>
  );
}

export function AreaAuthoredPage({ detail }: { detail: AreaDetail }) {
  const { data: view } = useAreaPage(detail.area.id);
  const scope = areaPageScope(detail, `${detail.area.id}/${AREA_PAGE_FILE}`);
  return (
    <AreaContext.Provider value={detail}>
      <AuthoredPage view={view} scope={scope} />
    </AreaContext.Provider>
  );
}

function AuthoredPage({ view, scope }: { view: AuthoredPageView | undefined; scope: PageScope }) {
  const fileName = scope.pagePath.split("/").pop() ?? scope.pagePath;
  if (!view || view.kind === "none") {
    return null;
  }
  if (view.kind === "failed") {
    return (
      <PageProblem title={`${fileName} doesn't compile`}>
        {view.errors.map((error) => `${errorLocation(error)}${error.message}`).join("\n")}
      </PageProblem>
    );
  }
  return (
    <PageScopeContext.Provider value={scope}>
      <ReviewProvider docPath={scope.pagePath} raw={view.source} docHash={view.sourceHash}>
        <BuiltPage code={`${view.code}\n//# sourceURL=${scope.pagePath}`} hash={view.hash} fileName={fileName} />
        <PageThreads />
      </ReviewProvider>
    </PageScopeContext.Provider>
  );
}

function BuiltPage({ code, hash, fileName }: { code: string; hash: string; fileName: string }) {
  const loaded = useMemo(() => loadPage(code), [code]);
  if (loaded.kind === "broken") {
    return <PageProblem title={`${fileName} failed to load`}>{loaded.message}</PageProblem>;
  }
  const { Page } = loaded;
  return (
    <PageErrorBoundary key={hash} fileName={fileName}>
      <CommentableBlocks>
        <div className="plan-body mb-12">
          <Page />
        </div>
      </CommentableBlocks>
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

class PageErrorBoundary extends Component<
  { children: ReactNode; fileName: string },
  { failure: RenderFailure | null }
> {
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
      <PageProblem title={`${this.props.fileName} failed to render`}>
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
