import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { stream } from "hono/streaming";
import { mimeTypeFor } from "./mime.js";
import { resolveInsideRoot } from "./safePath.js";

export const TOKEN_META_NAME = "timthink-token";

export function defaultWebDist(): string {
  return fileURLToPath(new URL("../../web/dist", import.meta.url));
}

export function injectToken(html: string, token: string): string {
  const meta = `<meta name="${TOKEN_META_NAME}" content="${token}">`;
  return html.includes("</head>") ? html.replace("</head>", `${meta}</head>`) : `${meta}${html}`;
}

export function mountWebApp(app: Hono, webDist: string, token: string): boolean {
  const indexPath = `${webDist}/index.html`;
  if (!existsSync(indexPath)) {
    app.get("*", (c) => c.text("timthink web assets are not built. Run `pnpm build`.", 503));
    return false;
  }
  const indexHtml = async (): Promise<string> => injectToken(await readFile(indexPath, "utf8"), token);

  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
    const requested = decodeURIComponent(c.req.path.replace(/^\/+/, ""));
    const absolute = requested ? await resolveInsideRoot(webDist, requested).catch(() => null) : null;
    const stats = absolute ? await stat(absolute).catch(() => null) : null;
    if (!absolute || !stats?.isFile() || requested === "index.html") {
      c.header("Cache-Control", "no-store");
      return c.html(await indexHtml());
    }
    c.header("Content-Type", mimeTypeFor(absolute));
    c.header("Content-Length", String(stats.size));
    c.header("Cache-Control", requested.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    return stream(c, async (out) => {
      for await (const chunk of createReadStream(absolute)) {
        if (chunk instanceof Buffer) await out.write(new Uint8Array(chunk));
      }
    });
  });
  return true;
}
