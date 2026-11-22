import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { type BuildFailure, type BuildOptions, build, type Message, type Plugin } from "esbuild";

export const PROJECT_PAGE_FILE = "project.page.tsx";
export const PAGE_MODULE = "timthink/page";

const HUB_EXTERNALS = ["react", "react/jsx-runtime", PAGE_MODULE];
const CHECK_EXTERNALS = ["react", "react/jsx-runtime", "react-dom", "react-dom/server", "mermaid"];

export interface PageBuildError {
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
}

export type PageBundle =
  | { kind: "built"; code: string; inputs: string[] }
  | { kind: "failed"; errors: PageBuildError[] };

export type ProjectPageView =
  | { kind: "none" }
  | { kind: "built"; code: string; hash: string }
  | { kind: "failed"; errors: PageBuildError[] };

export function isPageFile(relPath: string) {
  return relPath.endsWith(".page.tsx");
}

export function bundlePageForHub(docsRoot: string, pageFile: string) {
  return runBuild({ absWorkingDir: docsRoot, entryPoints: [pageFile], platform: "browser", external: HUB_EXTERNALS });
}

export interface CheckBundleInput {
  docsRoot: string;
  pageFile: string;
  pageApiFile: string;
  harnessFile: string;
}

export function bundlePageForCheck({ docsRoot, pageFile, pageApiFile, harnessFile }: CheckBundleInput) {
  const contents = [
    `import { createElement } from "react";`,
    `import { renderToString } from "react-dom/server";`,
    `import Page from ${JSON.stringify(pageFile)};`,
    `import { CheckHarness } from ${JSON.stringify(harnessFile)};`,
    "export function render(project) {",
    "  return renderToString(createElement(CheckHarness, { project }, createElement(Page)));",
    "}",
  ].join("\n");
  return runBuild({
    absWorkingDir: docsRoot,
    stdin: { contents, resolveDir: docsRoot, loader: "tsx", sourcefile: "check-entry.tsx" },
    platform: "node",
    external: CHECK_EXTERNALS,
    plugins: [pageModuleAt(pageApiFile)],
  });
}

export class ProjectPages {
  private readonly built = new Map<string, { key: string; inputs: string[]; view: ProjectPageView }>();

  constructor(private readonly docsRoot: string) {}

  async forProject(projectId: string): Promise<ProjectPageView> {
    const pageFile = path.join(this.docsRoot, projectId, PROJECT_PAGE_FILE);
    if (!(await fileExists(pageFile))) {
      this.built.delete(projectId);
      return { kind: "none" };
    }
    const cached = this.built.get(projectId);
    if (cached && cached.key === (await this.inputsKey(cached.inputs))) {
      return cached.view;
    }
    const bundle = await bundlePageForHub(this.docsRoot, pageFile);
    if (bundle.kind === "failed") {
      this.built.delete(projectId);
      return bundle;
    }
    const key = await this.inputsKey(bundle.inputs);
    const view: ProjectPageView = { kind: "built", code: bundle.code, hash: key.slice(0, 16) };
    this.built.set(projectId, { key, inputs: bundle.inputs, view });
    return view;
  }

  private async inputsKey(inputs: readonly string[]) {
    const hash = createHash("sha256");
    for (const input of inputs) {
      const content = await readFile(path.join(this.docsRoot, input)).catch(() => null);
      hash
        .update(input)
        .update("\0")
        .update(content ?? "missing")
        .update("\0");
    }
    return hash.digest("hex");
  }
}

async function runBuild(options: BuildOptions): Promise<PageBundle> {
  try {
    const result = await build({
      ...options,
      bundle: true,
      write: false,
      format: "cjs",
      jsx: "automatic",
      target: "es2022",
      metafile: true,
      logLevel: "silent",
    });
    return {
      kind: "built",
      code: result.outputFiles[0]?.text ?? "",
      inputs: Object.keys(result.metafile.inputs).filter((input) => !input.startsWith("<stdin>")),
    };
  } catch (error) {
    if (isBuildFailure(error)) {
      return { kind: "failed", errors: error.errors.map(toPageBuildError) };
    }
    throw error;
  }
}

function pageModuleAt(pageApiFile: string): Plugin {
  return {
    name: "timthink-page",
    setup(builder) {
      builder.onResolve({ filter: /^timthink\/page$/ }, () => ({ path: pageApiFile }));
    },
  };
}

function toPageBuildError(message: Message): PageBuildError {
  return {
    file: message.location?.file ?? null,
    line: message.location?.line ?? null,
    column: message.location?.column ?? null,
    message: message.text,
  };
}

function isBuildFailure(error: unknown): error is BuildFailure {
  return error instanceof Error && "errors" in error && Array.isArray(error.errors);
}

function fileExists(absolute: string) {
  return access(absolute).then(
    () => true,
    () => false,
  );
}
