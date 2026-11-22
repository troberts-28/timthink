import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bundlePageForCheck,
  type PageBuildError,
  type ProjectDetail,
  type ProjectRecord,
  ProjectRegistry,
} from "@timthink/server";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import * as ReactDomServer from "react-dom/server";

const WEB_PAGE_DIR = fileURLToPath(new URL("../../../web/src/page/", import.meta.url));
const BLOCK_ID = /data-block-id="([^"]*)"/g;

const CHECK_MODULES: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "react-dom": ReactDom,
  "react-dom/server": ReactDomServer,
};

export interface PageCheckInput {
  docsRoot: string;
  pageFile: string;
}

export async function checkPage({ docsRoot, pageFile }: PageCheckInput) {
  const bundle = await bundlePageForCheck({
    docsRoot,
    pageFile,
    pageApiFile: path.join(WEB_PAGE_DIR, "index.ts"),
    harnessFile: path.join(WEB_PAGE_DIR, "checkHarness.tsx"),
  });
  if (bundle.kind === "failed") {
    return bundle.errors.map((error) => ({ ...error, file: error.file && path.resolve(docsRoot, error.file) }));
  }
  const project = stubProject({ record: await projectRecordFor(docsRoot, pageFile), pageFile, docsRoot });
  const pageProblem = (message: string): PageBuildError => ({ file: pageFile, line: null, column: null, message });
  let html: string;
  try {
    html = renderBundle(bundle.code, project);
  } catch (error) {
    return [pageProblem(`The page failed to render: ${error instanceof Error ? error.message : String(error)}`)];
  }
  return duplicateBlockIds(html).map((id) => pageProblem(`Block id "${id}" is used more than once`));
}

function renderBundle(code: string, project: ProjectDetail) {
  const checkModule: { exports: Record<string, unknown> } = { exports: {} };
  new Function("require", "module", "exports", code)(requireCheckModule, checkModule, checkModule.exports);
  const render = checkModule.exports.render;
  if (!isRender(render)) {
    throw new Error("the check bundle has no render function");
  }
  return render(project);
}

function requireCheckModule(name: string) {
  const found = CHECK_MODULES[name];
  if (found === undefined) {
    throw new Error(`Pages can import react, timthink/page and relative files, not "${name}"`);
  }
  return found;
}

function isRender(value: unknown): value is (project: ProjectDetail) => string {
  return typeof value === "function";
}

function duplicateBlockIds(html: string) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const [, id = ""] of html.matchAll(BLOCK_ID)) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  return [...duplicates];
}

async function projectRecordFor(docsRoot: string, pageFile: string) {
  const registry = new ProjectRegistry(docsRoot);
  await registry.scan();
  return registry.projectForPath(path.relative(docsRoot, pageFile).split(path.sep).join("/"));
}

function stubProject({ record, pageFile, docsRoot }: StubProjectInput): ProjectDetail {
  const id = record?.id ?? path.relative(docsRoot, path.dirname(pageFile)).split(path.sep).join("/");
  return {
    project: {
      id,
      area: record?.area ?? null,
      slug: record?.slug ?? path.basename(id),
      title: record?.manifest.title ?? id,
      summary: record?.manifest.summary ?? null,
      status: record?.manifest.status ?? "active",
      repos: record?.manifest.repos ?? [],
      problems: [],
      docs: [],
      attachmentCount: 0,
      lastActivity: 0,
    },
    area: null,
    repoLinks: {},
    prs: { status: "ok", message: null, stacks: [], detached: [] },
    questions: [],
    threads: [],
    activity: [],
    rounds: [],
    looksFinished: [],
    attachments: [],
  };
}

interface StubProjectInput {
  record: ProjectRecord | null;
  pageFile: string;
  docsRoot: string;
}
