import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import type { ChecklistResults } from "../pages/checklistStore.js";
import { PROJECT_PAGE_FILE } from "../pages/pageFile.js";
import type { ProjectDetail } from "../projects/projectView.js";
import { EXPORT_DATA_ELEMENT_ID, type ProjectExport } from "./exportData.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WEB_SRC = path.join(REPO_ROOT, "web", "src");
const WEB_NODE_MODULES = path.join(REPO_ROOT, "web", "node_modules");
const SERVER_SHARED = path.join(REPO_ROOT, "server", "src", "shared.ts");
const MAX_EXPORTED_FILE_BYTES = 10 * 1024 * 1024;
const CSS_ASSET_URL = /url\(\/assets\/([^)"']+)\)/g;

export interface ExportFile {
  path: string;
  data: Buffer;
}

export interface ProjectExportInput {
  docsRoot: string;
  webDist: string;
  detail: ProjectDetail;
  checklists: Record<string, ChecklistResults>;
  publishedAt: Date;
  expiresAt: Date;
}

export class ExportError extends Error {}

export async function buildProjectExport(input: ProjectExportInput): Promise<ExportFile[]> {
  const { docsRoot, detail } = input;
  const pagePath = `${detail.project.id}/${PROJECT_PAGE_FILE}`;
  const pageFile = path.join(docsRoot, pagePath);
  const data: ProjectExport = {
    detail: { ...detail, questions: [], threads: [], rounds: [], looksFinished: [], sessions: [] },
    pagePath,
    docs: await Promise.all(
      detail.project.docs.map(async (doc) => ({
        path: doc.path,
        title: doc.title,
        kind: doc.kind,
        codeRepo: doc.codeRepo,
        status: doc.status,
        date: doc.date,
        raw: await readFile(path.join(docsRoot, doc.path), "utf8"),
      })),
    ),
    checklists: input.checklists,
    publishedAt: input.publishedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
  };
  const scripts = await bundleExport(docsRoot, (await fileExists(pageFile)) ? pageFile : null);
  const css = await hubStylesheet(input.webDist);
  const attachments = detail.attachments.filter((attachment) => attachment.size <= MAX_EXPORTED_FILE_BYTES);
  return [
    { path: "index.html", data: Buffer.from(indexHtml(data, css.name)) },
    ...scripts,
    { path: "middleware.js", data: Buffer.from(expiryMiddleware(input.expiresAt)) },
    ...css.files,
    ...(await Promise.all(
      attachments.map(async (attachment) => ({
        path: `files/${attachment.path}`,
        data: await readFile(path.join(docsRoot, attachment.path)),
      })),
    )),
  ];
}

export function expiryMiddleware(expiresAt: Date) {
  return [
    `const EXPIRES_AT = ${expiresAt.getTime()};`,
    "export default function middleware() {",
    "  if (Date.now() >= EXPIRES_AT) {",
    '    return new Response("This page has expired.", { status: 410, headers: { "content-type": "text/plain" } });',
    "  }",
    '  return new Response(null, { headers: { "x-middleware-next": "1" } });',
    "}",
    "",
  ].join("\n");
}

function indexHtml(data: ProjectExport, cssName: string) {
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${escapeHtml(data.detail.project.title)}</title>`,
    `<link rel="stylesheet" href="/assets/${cssName}">`,
    "</head>",
    "<body>",
    '<div id="root"></div>',
    `<script type="application/json" id="${EXPORT_DATA_ELEMENT_ID}">${json}</script>`,
    '<script type="module" src="/app.js"></script>',
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

const EXPORT_ENTRY = "timthink-export-entry";
const SCRIPT_OUT_DIR = "timthink-export-out";

async function bundleExport(docsRoot: string, pageFile: string | null): Promise<ExportFile[]> {
  const contents = [
    `import { renderExport } from ${JSON.stringify(path.join(WEB_SRC, "export", "main.tsx"))};`,
    pageFile ? `import Page from ${JSON.stringify(pageFile)};` : "const Page = null;",
    "renderExport(Page);",
  ].join("\n");
  const outdir = path.join(docsRoot, SCRIPT_OUT_DIR);
  const result = await build({
    entryPoints: { app: EXPORT_ENTRY },
    absWorkingDir: docsRoot,
    outdir,
    chunkNames: "chunks/[name]-[hash]",
    bundle: true,
    splitting: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    nodePaths: [WEB_NODE_MODULES],
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
    plugins: [exportModules({ contents, resolveDir: docsRoot })],
  }).catch((error: unknown) => {
    throw new ExportError(`The page didn't bundle for publishing: ${error instanceof Error ? error.message : error}`);
  });
  return result.outputFiles.map((file) => ({
    path: path.relative(outdir, file.path).split(path.sep).join("/"),
    data: Buffer.from(file.contents),
  }));
}

function exportModules(entry: { contents: string; resolveDir: string }): Plugin {
  return {
    name: "timthink-export",
    setup(builder) {
      builder.onResolve({ filter: new RegExp(`^${EXPORT_ENTRY}$`) }, () => ({
        path: EXPORT_ENTRY,
        namespace: "entry",
      }));
      builder.onLoad({ filter: /.*/, namespace: "entry" }, () => ({ ...entry, loader: "tsx" }));
      builder.onResolve({ filter: /^timthink\/page$/ }, () => ({ path: path.join(WEB_SRC, "page", "index.ts") }));
      builder.onResolve({ filter: /^@timthink\/server\/shared$/ }, () => ({ path: SERVER_SHARED }));
    },
  };
}

async function hubStylesheet(webDist: string) {
  const assetsDir = path.join(webDist, "assets");
  const names = await readdir(assetsDir).catch(() => []);
  const name = names.find((candidate) => candidate.endsWith(".css"));
  if (!name) {
    throw new ExportError(`No built stylesheet in ${assetsDir}. Run \`pnpm build\` first.`);
  }
  const css = await readFile(path.join(assetsDir, name), "utf8");
  const referenced = [...new Set([...css.matchAll(CSS_ASSET_URL)].flatMap((match) => match[1] ?? []))];
  const fonts = await Promise.all(
    referenced.map(async (asset) => ({
      path: `assets/${asset}`,
      data: await readFile(path.join(assetsDir, asset)),
    })),
  );
  return { name, files: [{ path: `assets/${name}`, data: Buffer.from(css) }, ...fonts] };
}

function escapeHtml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function fileExists(absolute: string) {
  return access(absolute).then(
    () => true,
    () => false,
  );
}
