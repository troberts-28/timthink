import { randomBytes, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export const TOKEN_HEADER = "x-timthink-token";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function createSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

export function allowedOrigins(port: number, extraOrigins: readonly string[] = []): Set<string> {
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extraOrigins]);
}

function tokensMatch(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function loopbackHostGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (!LOOPBACK_HOSTS.has(new URL(c.req.url).hostname)) return c.text("Forbidden host", 403);
    await next();
  };
}

export function sameOriginReadGuard(origins: ReadonlySet<string>): MiddlewareHandler {
  return async (c, next) => {
    const fetchSite = c.req.header("sec-fetch-site");
    const origin = c.req.header("origin");
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return c.text("Forbidden", 403);
    if (origin && !origins.has(origin)) return c.text("Forbidden origin", 403);
    await next();
  };
}

export function mutationGuard(origins: ReadonlySet<string>, token: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") {
      await next();
      return;
    }
    const origin = c.req.header("origin");
    if (!origin || !origins.has(origin)) return c.json({ error: "Forbidden origin" }, 403);
    if (!tokensMatch(token, c.req.header(TOKEN_HEADER))) return c.json({ error: "Invalid token" }, 403);
    await next();
  };
}
