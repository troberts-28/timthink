import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { DocsStore } from "../docs/store.js";
import type { DocArchive } from "../docs/types.js";
import { ReadOnlyError } from "../readOnly.js";
import type { ArchiveService } from "./archiveService.js";
import { ARCHIVE_ACTIONS } from "./archiveStore.js";

export interface ArchiveResponse {
  path: string;
  archive: DocArchive;
}

const archiveBody = z.object({ path: z.string().min(1), action: z.enum(ARCHIVE_ACTIONS) });

export interface ArchiveRouteDeps {
  store: DocsStore;
  archive: ArchiveService;
  onChange: (docPath: string) => void;
}

export function archiveRoutes({ store, archive, onChange }: ArchiveRouteDeps) {
  return new Hono().post("/", zValidator("json", archiveBody), async (c) => {
    const { path, action } = c.req.valid("json");
    const doc = store.getDoc(path);
    if (!doc) return c.json({ error: "Not found" }, 404);
    try {
      await archive.apply(path, action);
    } catch (error) {
      if (error instanceof ReadOnlyError) return c.json({ error: error.message }, 403);
      throw error;
    }
    onChange(path);
    return c.json<ArchiveResponse>({ path, archive: archive.stateFor(doc) });
  });
}
