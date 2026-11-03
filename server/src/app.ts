import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { stream, streamSSE } from "hono/streaming";
import { z } from "zod";
import type { ArchiveService } from "./archive/archiveService.js";
import { archiveRoutes } from "./archive/routes.js";
import type { CodeMatch, CodeResolution, CodeService, SessionCheckoutHint } from "./code/codeService.js";
import type { OpenInEditor } from "./code/editor.js";
import { isCheckoutOfRepo } from "./code/repoCheckouts.js";
import type { TimthinkConfig } from "./config.js";
import type { DocsStore } from "./docs/store.js";
import type { DocDetail, DocsIndex } from "./docs/types.js";
import type { EventHub, HubEvent } from "./events.js";
import { parseFrontmatter } from "./frontmatter.js";
import type { HistoryService } from "./history/historyService.js";
import { historyRoutes } from "./history/routes.js";
import type { InboxService } from "./inbox/inboxService.js";
import { mimeTypeFor } from "./mime.js";
import { docHash } from "./reviews/paths.js";
import type { ReviewService } from "./reviews/reviewService.js";
import { reviewRoutes } from "./reviews/routes.js";
import { PathOutsideRootError, resolveInsideRoot } from "./safePath.js";
import { loopbackHostGuard, mutationGuard, sameOriginReadGuard } from "./security.js";
import { seenRoutes } from "./seen/routes.js";
import type { SeenStore } from "./seen/seenStore.js";
import type { SessionRecord, SessionStore } from "./sessions/sessionStore.js";
import type { SessionsResponse, SessionView } from "./sessions/types.js";
import {
  isExistingDirectory,
  isSessionId,
  isWarpFocusUrl,
  type OpenUrl,
  RESUME_TAB_CONFIG_URL,
  writeResumeTabConfig,
} from "./sessions/warp.js";

const SSE_KEEPALIVE_MS = 25_000;

export interface AppDeps {
  config: TimthinkConfig;
  store: DocsStore;
  hub: EventHub;
  code: CodeService;
  openInEditor: OpenInEditor;
  sessions: SessionStore;
  reviews: ReviewService;
  history: HistoryService;
  seen: SeenStore;
  inbox: InboxService;
  archive: ArchiveService;
  onArchiveChange: (docPath: string) => void;
  openUrl: OpenUrl;
  getIndex: () => DocsIndex;
  token: string;
  origins: ReadonlySet<string>;
}

export interface PublicCodeMatch {
  relPath: string;
  line: number | null;
  col: number | null;
  githubUrl: string | null;
}

export type ResolveCodeResponse =
  | { status: "resolved"; matches: PublicCodeMatch[] }
  | { status: "not-found" }
  | { status: "no-checkout" };

export type OpenCodeResponse =
  | { status: "opened"; match: PublicCodeMatch }
  | { status: "ambiguous"; matches: PublicCodeMatch[] }
  | { status: "not-found" }
  | { status: "no-checkout" }
  | { status: "error"; message: string };

export type SessionActionResponse =
  | { status: "focused" }
  | { status: "resumed"; cwd: string }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

const docPathQuery = z.object({ path: z.string().min(1) });

const repoQuery = z.object({ repo: z.string().min(1) });

const sessionParams = z.object({ id: z.string().min(1).max(64) });
const resumeBody = z.object({ reviewDoc: z.string().min(1).max(1024).optional() });

const RECENT_SESSIONS_LIMIT = 50;

const attachmentsQuery = z.object({ repo: z.string().min(1), project: z.string().min(1).optional() });

const resolveCodeQuery = z.object({
  repo: z.string().min(1),
  ref: z.string().min(1).max(1024),
  docPath: z.string().optional(),
});

const openCodeBody = z.object({
  repo: z.string().min(1),
  ref: z.string().min(1).max(1024),
  docPath: z.string().optional(),
});

function toPublicMatch({ relPath, line, col, githubUrl }: CodeMatch): PublicCodeMatch {
  return { relPath, line, col, githubUrl };
}

function toResolveResponse(resolution: CodeResolution): ResolveCodeResponse {
  if (resolution.status !== "resolved") return { status: resolution.status };
  return { status: "resolved", matches: resolution.matches.map(toPublicMatch) };
}

function eventPayload(event: HubEvent): { event: string; data: string } {
  return { event: event.type, data: JSON.stringify(event) };
}

const UNTRACKED_OPEN_WINDOW_MS = 12 * 60 * 60 * 1000;

function mayBeOpenUntracked(session: SessionRecord, now = Date.now()): boolean {
  if (session.livenessKnown || !session.lastActivity) return false;
  return now - Date.parse(session.lastActivity) < UNTRACKED_OPEN_WINDOW_MS;
}

async function toSessionView(session: SessionRecord, docPath: string | null = null): Promise<SessionView> {
  return {
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    branch: session.branch,
    firstSeen: session.firstSeen,
    lastActivity: session.lastActivity,
    live: session.live,
    warpFocusUrl: isWarpFocusUrl(session.warpFocusUrl) ? session.warpFocusUrl : null,
    canResume: isSessionId(session.id) && (await isExistingDirectory(session.cwd)),
    mayBeOpenUntracked: mayBeOpenUntracked(session),
    wroteDoc: docPath === null ? null : session.writtenDocPaths.includes(docPath),
  };
}

async function sessionsResponse(
  sessions: readonly SessionRecord[],
  scanning: boolean,
  docPath: string | null = null,
): Promise<SessionsResponse> {
  return { sessions: await Promise.all(sessions.map((session) => toSessionView(session, docPath))), scanning };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const RAW_PREFIX = "/api/raw/";

function rawPathFrom(requestPath: string): string {
  return requestPath.slice(RAW_PREFIX.length).split("/").map(decodeURIComponent).join("/");
}

async function serveDocsFile(c: Context, docsRoot: string, requested: string): Promise<Response> {
  let absolute: string;
  try {
    absolute = await resolveInsideRoot(docsRoot, requested);
  } catch (error) {
    if (error instanceof PathOutsideRootError) return c.text("Forbidden", 403);
    return c.text("Not found", 404);
  }
  const stats = await stat(absolute).catch(() => null);
  if (!stats?.isFile()) return c.text("Not found", 404);
  c.header("Content-Type", mimeTypeFor(absolute));
  c.header("Content-Length", String(stats.size));
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", "sandbox allow-scripts");
  c.header("Cache-Control", "no-cache");
  return stream(c, async (out) => {
    for await (const chunk of createReadStream(absolute)) {
      if (chunk instanceof Buffer) await out.write(new Uint8Array(chunk));
    }
  });
}

export function createApp(deps: AppDeps) {
  const { config, store, hub, code, sessions } = deps;

  const checkoutContext = (repo: string, docPath: string | undefined) => {
    if (!docPath) return { docBranch: null, session: null };
    const docBranch = store.getDoc(docPath)?.branch ?? null;
    const linked = sessions
      .forDoc(docPath)
      .find((session) => session.cwd && isCheckoutOfRepo(config, repo, session.cwd));
    const session: SessionCheckoutHint | null = linked?.cwd ? { worktree: linked.cwd } : null;
    return { docBranch, session };
  };

  const focusSession = async (session: SessionRecord): Promise<SessionActionResponse> => {
    if (!session.live || !isWarpFocusUrl(session.warpFocusUrl)) {
      return { status: "unavailable", message: "This session isn't running in a Warp tab" };
    }
    await deps.openUrl(session.warpFocusUrl);
    return { status: "focused" };
  };

  const resumeSession = async (session: SessionRecord, reviewDoc?: string): Promise<SessionActionResponse> => {
    if (!isSessionId(session.id)) return { status: "unavailable", message: "This session id can't be resumed" };
    if (!session.cwd || !(await isExistingDirectory(session.cwd))) {
      return { status: "unavailable", message: "The session's directory no longer exists" };
    }
    if (reviewDoc !== undefined && !store.getDoc(reviewDoc)) {
      return { status: "unavailable", message: "Unknown doc to review" };
    }
    const prompt = reviewDoc === undefined ? null : `/timthink review ${reviewDoc}`;
    await writeResumeTabConfig(config.warpTabConfigDir, session.id, session.cwd, prompt);
    await deps.openUrl(RESUME_TAB_CONFIG_URL);
    return { status: "resumed", cwd: session.cwd };
  };

  const runSessionAction = async (
    id: string,
    action: (session: SessionRecord) => Promise<SessionActionResponse>,
  ): Promise<{ body: SessionActionResponse; status: 200 | 404 }> => {
    await sessions.refreshLiveness(0);
    const session = sessions.get(id);
    if (!session) return { body: { status: "unavailable", message: "Unknown session" }, status: 404 };
    try {
      return { body: await action(session), status: 200 };
    } catch (error) {
      return { body: { status: "error", message: errorMessage(error, "Couldn't open Warp") }, status: 200 };
    }
  };

  return new Hono()
    .use("*", loopbackHostGuard())
    .use("/api/*", mutationGuard(deps.origins, deps.token))
    .get("/api/health", (c) => c.json({ ok: true as const, docsRoot: config.docsRoot }))
    .get("/api/session-token", sameOriginReadGuard(deps.origins), (c) => c.json({ token: deps.token }))
    .get("/api/index", (c) => c.json(deps.getIndex()))
    .get("/api/doc", zValidator("query", docPathQuery), async (c) => {
      const { path: docPath } = c.req.valid("query");
      const summary = store.getDoc(docPath);
      if (!summary) return c.json({ error: "Not found" }, 404);
      const absolute = await resolveInsideRoot(config.docsRoot, docPath).catch(() => null);
      const raw = absolute ? await readFile(absolute, "utf8").catch(() => null) : null;
      if (raw === null) return c.json({ error: "Not found" }, 404);
      const detail: DocDetail = {
        summary,
        raw,
        hash: docHash(raw),
        frontmatter: parseFrontmatter(raw).data,
        attachments: store.attachmentsFor(summary),
      };
      return c.json(detail);
    })
    .get("/api/attachments", zValidator("query", attachmentsQuery), (c) => {
      const { repo, project } = c.req.valid("query");
      return c.json({ attachments: store.attachmentsIn(repo, project ?? null) });
    })
    .get("/api/attachment", zValidator("query", docPathQuery), (c) =>
      serveDocsFile(c, config.docsRoot, c.req.valid("query").path),
    )
    .get("/api/raw/*", (c) => serveDocsFile(c, config.docsRoot, rawPathFrom(c.req.path)))
    .get("/api/resolve-code", zValidator("query", resolveCodeQuery), async (c) => {
      const { repo, ref, docPath } = c.req.valid("query");
      const resolution = await code.resolve({ repo, ref, ...checkoutContext(repo, docPath) });
      return c.json(toResolveResponse(resolution));
    })
    .post("/api/open-code", zValidator("json", openCodeBody), async (c) => {
      const { repo, ref, docPath } = c.req.valid("json");
      const resolution = await code.resolve({ repo, ref, ...checkoutContext(repo, docPath) });
      if (resolution.status !== "resolved") return c.json<OpenCodeResponse>({ status: resolution.status });
      const [only, ...others] = resolution.matches;
      if (!only) return c.json<OpenCodeResponse>({ status: "not-found" });
      if (others.length > 0) {
        return c.json<OpenCodeResponse>({ status: "ambiguous", matches: resolution.matches.map(toPublicMatch) });
      }
      if (!(await code.isOpenable(only.absPath))) {
        return c.json<OpenCodeResponse>({ status: "error", message: "Path is outside the configured code roots" });
      }
      try {
        await deps.openInEditor(only.absPath, only.line, only.col);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not open editor";
        return c.json<OpenCodeResponse>({ status: "error", message });
      }
      return c.json<OpenCodeResponse>({ status: "opened", match: toPublicMatch(only) });
    })
    .get("/api/doc-sessions", zValidator("query", docPathQuery), async (c) => {
      const { path: docPath } = c.req.valid("query");
      await sessions.refreshLiveness();
      return c.json(await sessionsResponse(sessions.forDoc(docPath), sessions.scanning, docPath));
    })
    .get("/api/sessions", zValidator("query", repoQuery), async (c) => {
      const { repo } = c.req.valid("query");
      await sessions.refreshLiveness();
      const prefix = `${repo}/`;
      const matching = sessions
        .all()
        .filter(
          (session) =>
            (session.cwd !== null && isCheckoutOfRepo(config, repo, session.cwd)) ||
            session.docPaths.some((docPath) => docPath.startsWith(prefix)),
        )
        .slice(0, RECENT_SESSIONS_LIMIT);
      return c.json(await sessionsResponse(matching, sessions.scanning));
    })
    .post("/api/sessions/:id/focus", zValidator("param", sessionParams), async (c) => {
      const { body, status } = await runSessionAction(c.req.valid("param").id, focusSession);
      return c.json<SessionActionResponse>(body, status);
    })
    .post("/api/sessions/:id/resume", zValidator("param", sessionParams), zValidator("json", resumeBody), async (c) => {
      const { reviewDoc } = c.req.valid("json");
      const resume = (session: SessionRecord) => resumeSession(session, reviewDoc);
      const { body, status } = await runSessionAction(c.req.valid("param").id, resume);
      return c.json<SessionActionResponse>(body, status);
    })
    .route("/api/review", reviewRoutes(deps.reviews))
    .route("/api/history", historyRoutes(store, deps.history, deps.seen))
    .route(
      "/api/seen",
      seenRoutes({
        store,
        seen: deps.seen,
        history: deps.history,
        onChange: (docPath) => hub.publish({ type: "seen-changed", path: docPath, version: hub.nextVersion() }),
      }),
    )
    .route("/api/archive", archiveRoutes({ store, archive: deps.archive, onChange: deps.onArchiveChange }))
    .get("/api/inbox", async (c) => c.json(await deps.inbox.build()))
    .get("/api/events", (c) =>
      streamSSE(c, async (sse) => {
        const unsubscribe = hub.subscribe((event) => {
          void sse.writeSSE(eventPayload(event));
        });
        const keepalive = setInterval(() => {
          void sse.writeSSE({ event: "ping", data: "" });
        }, SSE_KEEPALIVE_MS);
        await sse.writeSSE({ event: "ready", data: "{}" });
        await new Promise<void>((resolve) => sse.onAbort(resolve));
        clearInterval(keepalive);
        unsubscribe();
      }),
    );
}

export type AppType = ReturnType<typeof createApp>;
