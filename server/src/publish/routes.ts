import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type ChecklistStore, projectChecklistOwner } from "../pages/checklistStore.js";
import type { ProjectDetail } from "../projects/projectView.js";
import type { ProjectRecord, ProjectRegistry } from "../projects/registry.js";
import { ExportError } from "./projectExport.js";
import { MAX_PUBLISH_TTL_MS, MIN_PUBLISH_TTL_MS, PublishError, type Publisher } from "./publisher.js";
import { VercelError } from "./vercel.js";

const HOUR_MS = 60 * 60 * 1000;

export interface PublishRouteDeps {
  publisher: Publisher;
  registry: ProjectRegistry;
  checklists: ChecklistStore;
  detailOf(record: ProjectRecord): Promise<ProjectDetail | null>;
}

const projectQuery = z.object({ project: z.string().min(1).max(256) });
const publishBody = z.object({
  project: z.string().min(1).max(256),
  ttlHours: z
    .number()
    .int()
    .min(MIN_PUBLISH_TTL_MS / HOUR_MS)
    .max(MAX_PUBLISH_TTL_MS / HOUR_MS),
});
const unpublishBody = z.object({ deploymentId: z.string().min(1).max(128) });

export function publishRoutes(deps: PublishRouteDeps) {
  return new Hono()
    .get("/", zValidator("query", projectQuery), async (c) =>
      c.json({
        canPublish: deps.publisher.canPublish,
        publishes: await deps.publisher.live(c.req.valid("query").project),
      }),
    )
    .post("/", zValidator("json", publishBody), async (c) => {
      const { project, ttlHours } = c.req.valid("json");
      const record = deps.registry.project(project);
      const detail = record ? await deps.detailOf(record) : null;
      if (!record || !detail) {
        return c.json({ error: "Not found" }, 404);
      }
      const checklists = await deps.checklists.readAll(projectChecklistOwner(record));
      return runPublish(c, () => deps.publisher.publish({ detail, checklists, ttlMs: ttlHours * HOUR_MS }));
    })
    .post("/unpublish", zValidator("json", unpublishBody), async (c) =>
      runPublish(c, () => deps.publisher.unpublish(c.req.valid("json").deploymentId)),
    );
}

async function runPublish<Result>(c: Context, action: () => Promise<Result>) {
  try {
    return c.json(await action());
  } catch (error) {
    if (error instanceof PublishError) {
      return c.json({ error: error.message, code: error.code }, error.code === "not-found" ? 404 : 400);
    }
    if (error instanceof VercelError || error instanceof ExportError) {
      return c.json({ error: error.message }, 502);
    }
    throw error;
  }
}
