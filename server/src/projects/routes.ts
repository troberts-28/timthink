import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { DocsStore } from "../docs/store.js";
import type { DocsIndex, GithubRepo } from "../docs/types.js";
import {
  areaChecklistOwner,
  CHECKLIST_ID_PATTERN,
  type ChecklistStore,
  MAX_STEP_NOTE_LENGTH,
  projectChecklistOwner,
} from "../pages/checklistStore.js";
import type { AuthoredPages } from "../pages/pageBundle.js";
import { AREA_PAGE_FILE, PROJECT_PAGE_FILE } from "../pages/pageFile.js";
import type { PrService } from "../prs/prService.js";
import { ReadOnlyError } from "../readOnly.js";
import type { ReviewStore } from "../reviews/reviewStore.js";
import type { RoundStore } from "../rounds/roundStore.js";
import { summarizeRound } from "../rounds/roundView.js";
import type { SessionRecord } from "../sessions/sessionStore.js";
import type { SessionView } from "../sessions/types.js";
import { PROJECT_STATUSES } from "./manifest.js";
import { ProjectError, type ProjectService } from "./projectService.js";
import { buildAreaDetail, buildProjectDetail, collectPrs, type PrViewDeps } from "./projectView.js";
import type { ProjectRecord, ProjectRegistry } from "./registry.js";

export interface ProjectRouteDeps {
  registry: ProjectRegistry;
  service: ProjectService;
  store: DocsStore;
  reviews: ReviewStore;
  rounds: RoundStore;
  prs: PrService;
  githubFor: (repo: string) => GithubRepo | null;
  getIndex: () => DocsIndex;
  pages: AuthoredPages;
  checklists: ChecklistStore;
  sessionsOf(belongs: (session: SessionRecord) => boolean): Promise<SessionView[]>;
}

const PR_ACTIONS = ["link", "unlink", "reattach"] as const;

const projectQuery = z.object({ id: z.string().min(1).max(256) });
const prBody = z.object({
  id: z.string().min(1).max(256),
  repo: z.string().min(1).max(128),
  number: z.number().int().positive(),
  action: z.enum(PR_ACTIONS),
});
const statusBody = z.object({ id: z.string().min(1).max(256), status: z.enum(PROJECT_STATUSES) });
const titleBody = z.object({ id: z.string().min(1).max(256), title: z.string().max(1_000) });
const checklistId = z.string().regex(CHECKLIST_ID_PATTERN);
const checklistQuery = projectQuery.extend({ checklist: checklistId });
const stepBody = checklistQuery.extend({
  step: checklistId,
  result: z
    .object({
      outcome: z.enum(["pass", "fail"]),
      note: z.string().max(MAX_STEP_NOTE_LENGTH),
      sha: z
        .string()
        .regex(/^[0-9a-f]{7,64}$/)
        .nullable(),
    })
    .nullable(),
});

export function projectRoutes(deps: ProjectRouteDeps) {
  return new Hono()
    .get("/", zValidator("query", projectQuery), async (c) => {
      const record = deps.registry.project(c.req.valid("query").id);
      if (!record) {
        return c.json({ error: "Not found" }, 404);
      }
      const detail = await projectDetailOf(deps, record);
      return detail ? c.json(detail) : c.json({ error: "Not found" }, 404);
    })
    .get("/page", zValidator("query", projectQuery), async (c) => {
      const record = deps.registry.project(c.req.valid("query").id);
      if (!record) {
        return c.json({ error: "Not found" }, 404);
      }
      return c.json(await deps.pages.forPage(`${record.id}/${PROJECT_PAGE_FILE}`));
    })
    .get("/checklist", zValidator("query", checklistQuery), async (c) => {
      const { id, checklist } = c.req.valid("query");
      const owner = checklistOwnerFor(deps.registry, id);
      return owner ? c.json(await deps.checklists.read(owner, checklist)) : c.json({ error: "Not found" }, 404);
    })
    .post("/checklist", zValidator("json", stepBody), async (c) => {
      const { id, checklist, step, result } = c.req.valid("json");
      const owner = checklistOwnerFor(deps.registry, id);
      if (!owner) {
        return c.json({ error: "Not found" }, 404);
      }
      try {
        const stamped = result ? { ...result, at: new Date().toISOString() } : null;
        return c.json(await deps.checklists.record({ owner, checklistId: checklist, stepId: step, result: stamped }));
      } catch (error) {
        if (error instanceof ReadOnlyError) {
          return c.json({ error: error.message }, 403);
        }
        throw error;
      }
    })
    .post("/pr", zValidator("json", prBody), async (c) => {
      const { id, repo, number, action } = c.req.valid("json");
      const ref = { repo, number };
      return runEdit(c, () =>
        action === "link"
          ? deps.service.linkPr(id, ref)
          : action === "unlink"
            ? deps.service.unlinkPr(id, ref)
            : deps.service.reattachPr(id, ref),
      );
    })
    .post("/status", zValidator("json", statusBody), async (c) => {
      const { id, status } = c.req.valid("json");
      return runEdit(c, () => deps.service.setStatus(id, status));
    })
    .post("/title", zValidator("json", titleBody), async (c) => {
      const { id, title } = c.req.valid("json");
      return runEdit(c, () => deps.service.rename(id, title));
    });
}

export function areaRoutes(deps: ProjectRouteDeps) {
  return new Hono()
    .get("/", zValidator("query", projectQuery), (c) => {
      const detail = buildAreaDetail({
        index: deps.getIndex(),
        areaId: c.req.valid("query").id,
        prsOf: (project) => {
          const record = deps.registry.project(project.id);
          return record ? collectPrs(projectViewDeps(deps, record), project.docs) : null;
        },
      });
      return detail ? c.json(detail) : c.json({ error: "Not found" }, 404);
    })
    .get("/page", zValidator("query", projectQuery), async (c) => {
      const area = deps.registry.area(c.req.valid("query").id);
      if (!area) {
        return c.json({ error: "Not found" }, 404);
      }
      return c.json(await deps.pages.forPage(`${area.id}/${AREA_PAGE_FILE}`));
    });
}

export async function projectDetailOf(deps: ProjectRouteDeps, record: ProjectRecord) {
  return buildProjectDetail({
    ...projectViewDeps(deps, record),
    contentOf: (docPath) => deps.store.contentOf(docPath),
    readReview: (docPath) => deps.reviews.read(docPath).catch(() => null),
    attachmentsUnder: (dir) => deps.store.attachmentsUnder(dir),
    rounds: (await deps.rounds.list()).map(summarizeRound),
    awaitingCompletion: (docPath) => deps.prs.awaitingCompletion(docPath),
    sessionsOf: deps.sessionsOf,
  });
}

function projectViewDeps(deps: ProjectRouteDeps, record: ProjectRecord): PrViewDeps {
  return {
    index: deps.getIndex(),
    record,
    docPrs: (docPath) => deps.prs.docPrs(docPath),
    githubFor: deps.githubFor,
    lookupPrs: (github, numbers) => deps.prs.lookup(github, numbers),
    infoFor: (github, number) => deps.prs.infoFor(github, number),
    stackOf: (github, numbers) => deps.prs.stackOf(github, numbers),
    prsEnabled: deps.prs.enabled,
    prsUnavailable: deps.prs.unavailableMessage,
  };
}

function checklistOwnerFor(registry: ProjectRegistry, id: string) {
  const project = registry.project(id);
  if (project) {
    return projectChecklistOwner(project);
  }
  const area = registry.area(id);
  return area ? areaChecklistOwner(area) : null;
}

async function runEdit(c: Context, edit: () => Promise<unknown>) {
  try {
    await edit();
  } catch (error) {
    if (error instanceof ReadOnlyError) {
      return c.json({ error: error.message }, 403);
    }
    if (error instanceof ProjectError) {
      return c.json({ error: error.message, code: error.code }, error.code === "not-found" ? 404 : 400);
    }
    throw error;
  }
  return c.json({ status: "ok" as const });
}
