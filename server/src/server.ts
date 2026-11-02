import { type ServerType, serve } from "@hono/node-server";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import { CodeService } from "./code/codeService.js";
import { createZedOpener, type OpenInEditor } from "./code/editor.js";
import { prLinkHostFor, type TimthinkConfig } from "./config.js";
import { DocsStore } from "./docs/store.js";
import type { DocsIndex, GithubRepo } from "./docs/types.js";
import { type DocsWatcher, watchDocsRoot } from "./docs/watcher.js";
import { EventHub } from "./events.js";
import { HistoryService } from "./history/historyService.js";
import { InboxService } from "./inbox/inboxService.js";
import { docHash, docPathForReviewFile } from "./reviews/paths.js";
import { type HubDocWrite, ReviewService } from "./reviews/reviewService.js";
import { allowedOrigins, createSessionToken } from "./security.js";
import { SeenStore } from "./seen/seenStore.js";
import { DOC_SESSIONS_LOG, SESSIONS_LOG } from "./sessions/hookLog.js";
import { type SessionChange, SessionStore } from "./sessions/sessionStore.js";
import { createMacOpener, type OpenUrl } from "./sessions/warp.js";
import { defaultWebDist, mountWebApp } from "./webAssets.js";

export const BIND_HOST = "127.0.0.1";

export interface StartOptions {
  config: TimthinkConfig;
  webDist?: string | null;
  extraOrigins?: readonly string[];
  openInEditor?: OpenInEditor;
  openUrl?: OpenUrl;
  watch?: boolean;
  log?: (message: string) => void;
}

export interface RunningServer {
  url: string;
  token: string;
  close(): Promise<void>;
}

class GithubByRepo {
  private readonly known = new Map<string, GithubRepo | null>();

  constructor(private readonly code: CodeService) {}

  get(repo: string): GithubRepo | null {
    return this.known.get(repo) ?? null;
  }

  async refresh(repos: Iterable<string>): Promise<void> {
    const missing = [...repos].filter((repo) => !this.known.has(repo));
    const resolved = await Promise.all(
      missing.map(async (repo) => [repo, await this.code.githubForRepo(repo)] as const),
    );
    for (const [repo, github] of resolved) this.known.set(repo, github);
  }
}

export interface Runtime {
  app: Hono;
  store: DocsStore;
  sessions: SessionStore;
  reviews: ReviewService;
  history: HistoryService;
  seen: SeenStore;
  inbox: InboxService;
  hub: EventHub;
  token: string;
  startHistory(): Promise<void>;
  startWatching(): DocsWatcher;
  startSessionTracking(): DocsWatcher;
}

const BACKFILL_INTERVAL_MS = 5 * 60_000;
const HOOK_LOGS = new Set([SESSIONS_LOG, DOC_SESSIONS_LOG]);

function startSessionTracking(sessions: SessionStore, log: (message: string) => void): DocsWatcher {
  const backfill = (): void => {
    sessions
      .runBackfill()
      .then((stats) => {
        if (stats.scanned > 0) {
          log(`backfilled ${stats.scanned}/${stats.files} transcript(s) in ${Math.round(stats.durationMs)}ms`);
        }
      })
      .catch((error: unknown) => log(`transcript backfill failed: ${String(error)}`));
  };
  backfill();
  const interval = setInterval(backfill, BACKFILL_INTERVAL_MS);
  interval.unref();
  const watcher = watchDocsRoot(
    sessions.stateDir,
    (relPaths) => {
      if (!relPaths.some((relPath) => HOOK_LOGS.has(relPath))) return;
      sessions
        .readHookLogs()
        .then((change) => sessions.refreshTranscripts(change.sessionIds))
        .catch((error: unknown) => log(`reading hook logs failed: ${String(error)}`));
    },
    { onError: (error) => log(`state watcher error: ${error.message}`) },
  );
  return {
    close(): void {
      clearInterval(interval);
      watcher.close();
    },
  };
}

export async function createRuntime(options: StartOptions): Promise<Runtime> {
  const { config } = options;
  const log = options.log ?? (() => {});
  const store = new DocsStore(config.docsRoot);
  const hub = new EventHub();
  const code = new CodeService(config);
  const github = new GithubByRepo(code);
  const token = createSessionToken();
  const seen = new SeenStore({ stateDir: config.stateDir, log });
  const sessions = new SessionStore({
    docsRoot: config.docsRoot,
    stateDir: config.stateDir,
    claudeProjectsDir: config.claudeProjectsDir,
    onChange: (change: SessionChange) => {
      hub.publish({ type: "sessions-changed", ...change, version: hub.nextVersion() });
    },
  });
  const history = new HistoryService({
    docsRoot: config.docsRoot,
    store,
    sessions,
    keepHashes: (docPath) => seen.keepHashes(docPath),
    onSnapshot: (docPath) => hub.publish({ type: "history-changed", path: docPath, version: hub.nextVersion() }),
    log,
  });
  const onHubDocWrite = ({ docPath, before, after, actorName }: HubDocWrite): void => {
    history.recordHubWrite(docPath, after, actorName);
    if (seen.get(docPath)?.hash !== docHash(before)) return;
    seen
      .markSeen(docPath, docHash(after))
      .then(() => hub.publish({ type: "seen-changed", path: docPath, version: hub.nextVersion() }))
      .catch((error: unknown) => log(`marking a hub write seen failed: ${String(error)}`));
  };
  const reviews = new ReviewService({
    docsRoot: config.docsRoot,
    userName: config.userName,
    onDocWrite: onHubDocWrite,
  });
  const inbox = new InboxService({ store, reviews: reviews.store, seen, history, sessions });

  await Promise.all([store.scanAll(), sessions.init()]);
  const seenInit = await seen.init(
    store.allDocs().flatMap((doc) => {
      const hash = store.contentOf(doc.path)?.hash;
      return hash ? [{ path: doc.path, hash }] : [];
    }),
  );
  if (seenInit.created) log(`initialised seen.json with ${store.allDocs().length} doc(s)`);
  let cachedIndex: DocsIndex | null = null;
  const repoNames = (): string[] => [...new Set(store.allDocs().map((doc) => doc.repo))];
  await github.refresh(repoNames());

  const getIndex = (): DocsIndex => {
    cachedIndex ??= store.buildIndex((repo) => ({ github: github.get(repo), prLinks: prLinkHostFor(config, repo) }));
    return cachedIndex;
  };

  const publishReviewChanges = (relPaths: readonly string[]): void => {
    const docPaths = new Set(relPaths.map(docPathForReviewFile).filter((docPath) => docPath !== null));
    for (const docPath of docPaths) hub.publish({ type: "review-changed", path: docPath, version: hub.nextVersion() });
  };

  const handleChanges = async (relPaths: string[]): Promise<void> => {
    publishReviewChanges(relPaths);
    const result = await store.applyChanges(relPaths);
    if (!result.changed) return;
    await github.refresh(repoNames());
    cachedIndex = null;
    history.schedule(result.changedDocs);
    for (const docPath of result.changedDocs) {
      hub.publish({ type: "doc-changed", path: docPath, version: hub.nextVersion() });
    }
    for (const docPath of result.removedDocs) {
      hub.publish({ type: "doc-removed", path: docPath, version: hub.nextVersion() });
    }
    hub.publish({ type: "index-changed", version: hub.nextVersion() });
    log(`re-indexed ${relPaths.length} path(s)`);
  };

  const app: Hono = createApp({
    config,
    store,
    hub,
    code,
    openInEditor: options.openInEditor ?? createZedOpener(),
    sessions,
    reviews,
    history,
    seen,
    inbox,
    openUrl: options.openUrl ?? createMacOpener(),
    getIndex,
    token,
    origins: allowedOrigins(config.port, options.extraOrigins),
  });

  const webDist = options.webDist === undefined ? defaultWebDist() : options.webDist;
  if (webDist) mountWebApp(app, webDist, token);

  return {
    app,
    store,
    sessions,
    reviews,
    history,
    seen,
    inbox,
    hub,
    token,
    startHistory: async () => {
      const stats = await history.snapshotAll();
      if (stats.saved > 0) {
        log(`snapshotted ${stats.saved}/${stats.docs} doc(s) in ${Math.round(stats.durationMs)}ms`);
      }
    },
    startSessionTracking: () => startSessionTracking(sessions, log),
    startWatching: () =>
      watchDocsRoot(
        config.docsRoot,
        (relPaths) => {
          handleChanges(relPaths).catch((error: unknown) => log(`re-index failed: ${String(error)}`));
        },
        { onError: (error) => log(`watcher error: ${error.message}`) },
      ),
  };
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const runtime = await createRuntime(options);
  const watcher = options.watch === false ? null : runtime.startWatching();
  const sessionTracking = options.watch === false ? null : runtime.startSessionTracking();
  if (options.watch !== false) {
    runtime.startHistory().catch((error: unknown) => options.log?.(`snapshotting docs failed: ${String(error)}`));
  }
  const server = await new Promise<ServerType>((resolve, reject) => {
    const instance = serve({ fetch: runtime.app.fetch, hostname: BIND_HOST, port: options.config.port }, () =>
      resolve(instance),
    );
    instance.once("error", reject);
  });
  return {
    url: `http://${BIND_HOST}:${options.config.port}`,
    token: runtime.token,
    close: () =>
      new Promise<void>((resolve) => {
        watcher?.close();
        sessionTracking?.close();
        runtime.history.close();
        server.close(() => resolve());
        if ("closeAllConnections" in server) server.closeAllConnections();
      }),
  };
}
