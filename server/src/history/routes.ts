import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { DocsStore } from "../docs/store.js";
import type { SeenEntry, SeenStore } from "../seen/seenStore.js";
import type { SnapshotView } from "./attribution.js";
import type { HistoryService } from "./historyService.js";

export interface DocHistory {
  path: string;
  hash: string;
  seen: SeenEntry | null;
  snapshots: SnapshotView[];
}

const docQuery = z.object({ path: z.string().min(1) });
const snapshotQuery = docQuery.extend({ id: z.string().min(1).max(64) });

export function historyRoutes(store: DocsStore, history: HistoryService, seen: SeenStore) {
  return new Hono()
    .get("/", zValidator("query", docQuery), async (c) => {
      const { path } = c.req.valid("query");
      const content = store.contentOf(path);
      if (!content) return c.json({ error: "Not found" }, 404);
      const response: DocHistory = {
        path,
        hash: content.hash,
        seen: seen.get(path),
        snapshots: await history.list(path),
      };
      return c.json(response);
    })
    .get("/snapshot", zValidator("query", snapshotQuery), async (c) => {
      const { path, id } = c.req.valid("query");
      if (!store.getDoc(path)) return c.json({ error: "Not found" }, 404);
      const raw = await history.read(path, id);
      if (raw === null) return c.json({ error: "Not found" }, 404);
      return c.json({ id, raw });
    });
}
