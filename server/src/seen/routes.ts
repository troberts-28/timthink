import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { DocsStore } from "../docs/store.js";
import type { HistoryService } from "../history/historyService.js";
import type { SeenEntry, SeenStore } from "./seenStore.js";

export interface SeenResponse {
  seen: SeenEntry | null;
}

const markSeenBody = z.object({ path: z.string().min(1), hash: z.string().min(1).max(64) });
const docBody = z.object({ path: z.string().min(1) });
const threadBody = docBody.extend({ threadId: z.string().min(1).max(64) });

export interface SeenRouteDeps {
  store: DocsStore;
  seen: SeenStore;
  history: HistoryService;
  onChange: (docPath: string) => void;
}

export function seenRoutes({ store, seen, history, onChange }: SeenRouteDeps) {
  return new Hono()
    .post("/", zValidator("json", markSeenBody), async (c) => {
      const { path, hash } = c.req.valid("json");
      if (!store.getDoc(path)) return c.json({ error: "Not found" }, 404);
      if (store.contentOf(path)?.hash === hash && !(await history.findByHash(path, hash))) {
        await history.snapshotNow(path);
      }
      const entry = await seen.markSeen(path, hash);
      onChange(path);
      return c.json<SeenResponse>({ seen: entry });
    })
    .post("/unseen", zValidator("json", docBody), async (c) => {
      const { path } = c.req.valid("json");
      const entry = await seen.markUnseen(path);
      onChange(path);
      return c.json<SeenResponse>({ seen: entry });
    })
    .post("/thread", zValidator("json", threadBody), async (c) => {
      const { path, threadId } = c.req.valid("json");
      await seen.markThreadRead(path, threadId);
      onChange(path);
      return c.json<SeenResponse>({ seen: seen.get(path) });
    });
}
