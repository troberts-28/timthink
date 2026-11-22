import {
  ChecklistStore,
  defaultWebDist,
  ExportError,
  type ProjectDetail,
  ProjectRegistry,
  PublishError,
  Publisher,
  projectChecklistOwner,
  type TimthinkConfig,
  VercelClient,
  VercelError,
} from "@timthink/server";

export const PUBLISH_USAGE = `Usage: timthink publish <project> [--ttl 7d]
       timthink unpublish <url>

Publishes a project's page, PRs and docs to an unlisted Vercel URL that stops working after --ttl
(1h to 90d; default 7d). Anyone with the link can read every doc in the project until then.
Needs VERCEL_TOKEN in the environment and the hub running.`;

const DEFAULT_TTL = "7d";
const TTL_PATTERN = /^(\d+)([hd])$/;
const HOUR_MS = 60 * 60 * 1000;
const UNIT_MS = { h: HOUR_MS, d: 24 * HOUR_MS } as const;

export interface PublishIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface PublishCommand {
  config: TimthinkConfig;
  target: string | undefined;
  ttl: string | undefined;
  io: PublishIo;
  vercelToken: string | undefined;
  fetchDetail: (projectId: string) => Promise<ProjectDetail | null>;
}

export async function runPublish({ config, target, ttl, io, vercelToken, fetchDetail }: PublishCommand) {
  if (!target) {
    io.err(PUBLISH_USAGE);
    return 1;
  }
  const ttlMs = ttlToMs(ttl ?? DEFAULT_TTL);
  if (ttlMs === null) {
    io.err(`Give --ttl as hours or days, like 12h or 7d`);
    return 1;
  }
  const registry = new ProjectRegistry(config.docsRoot);
  await registry.scan();
  const record = registry.project(target);
  if (!record) {
    io.err(`There is no project ${target}. Run \`timthink project list\` to see them.`);
    return 1;
  }
  const detail = await fetchDetail(target).catch(() => null);
  if (!detail) {
    io.err("Couldn't read the project from the hub. Start it (`timthink doctor` shows how) and try again.");
    return 1;
  }
  const checklists = await new ChecklistStore(config.docsRoot, true).readAll(projectChecklistOwner(record));
  return runWithPublisher(publisherFor(config, vercelToken), io, async (publisher) => {
    const published = await publisher.publish({ detail, checklists, ttlMs });
    io.out(published.url);
    io.out(`Anyone with the link can read it until ${published.expiresAt}. Vercel takes a minute to bring it up.`);
  });
}

export async function runUnpublish({ config, target, io, vercelToken }: Omit<PublishCommand, "ttl" | "fetchDetail">) {
  if (!target) {
    io.err(PUBLISH_USAGE);
    return 1;
  }
  return runWithPublisher(publisherFor(config, vercelToken), io, async (publisher) => {
    const removed = await publisher.unpublish(target);
    io.out(`Unpublished ${removed.url}`);
  });
}

function ttlToMs(ttl: string) {
  const match = TTL_PATTERN.exec(ttl);
  const unit = match?.[2];
  return match && (unit === "h" || unit === "d") ? Number(match[1]) * UNIT_MS[unit] : null;
}

function publisherFor(config: TimthinkConfig, vercelToken: string | undefined) {
  return new Publisher({
    docsRoot: config.docsRoot,
    stateDir: config.stateDir,
    webDist: defaultWebDist(),
    vercel: vercelToken ? new VercelClient({ token: vercelToken, fetch }) : null,
    now: () => new Date(),
  });
}

async function runWithPublisher(publisher: Publisher, io: PublishIo, action: (publisher: Publisher) => Promise<void>) {
  try {
    await action(publisher);
    return 0;
  } catch (error) {
    if (error instanceof PublishError || error instanceof VercelError || error instanceof ExportError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}
