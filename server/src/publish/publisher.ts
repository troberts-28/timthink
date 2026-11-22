import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ChecklistResults } from "../pages/checklistStore.js";
import type { ProjectDetail } from "../projects/projectView.js";
import { writeFileAtomic } from "../reviews/atomicWrite.js";
import { withFileLock } from "../reviews/fileLock.js";
import { buildProjectExport } from "./projectExport.js";
import type { VercelClient } from "./vercel.js";

export const PUBLISHES_FILE = "publishes.json";
export const MIN_PUBLISH_TTL_MS = 60 * 60 * 1000;
export const MAX_PUBLISH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const publishRecordSchema = z.object({
  deploymentId: z.string().min(1),
  projectId: z.string().min(1),
  url: z.string().url(),
  publishedAt: z.string(),
  expiresAt: z.string(),
});

const publishesFileSchema = z.object({ publishes: z.array(publishRecordSchema) });

export type PublishRecord = z.infer<typeof publishRecordSchema>;

export const PUBLISH_ERROR_CODES = ["no-token", "invalid-ttl", "not-found"] as const;

export class PublishError extends Error {
  constructor(
    readonly code: (typeof PUBLISH_ERROR_CODES)[number],
    message: string,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

export interface PublisherOptions {
  docsRoot: string;
  stateDir: string;
  webDist: string;
  vercel: VercelClient | null;
  now: () => Date;
}

export interface PublishRequest {
  detail: ProjectDetail;
  checklists: Record<string, ChecklistResults>;
  ttlMs: number;
}

export class Publisher {
  constructor(private readonly options: PublisherOptions) {}

  get canPublish() {
    return this.options.vercel !== null;
  }

  async publish({ detail, checklists, ttlMs }: PublishRequest): Promise<PublishRecord> {
    const vercel = this.requireVercel();
    if (!Number.isFinite(ttlMs) || ttlMs < MIN_PUBLISH_TTL_MS || ttlMs > MAX_PUBLISH_TTL_MS) {
      throw new PublishError("invalid-ttl", "Publish for between an hour and 90 days");
    }
    await this.removeExpired();
    const publishedAt = this.options.now();
    const expiresAt = new Date(publishedAt.getTime() + ttlMs);
    const files = await buildProjectExport({
      docsRoot: this.options.docsRoot,
      webDist: this.options.webDist,
      detail,
      checklists,
      publishedAt,
      expiresAt,
    });
    const deployment = await vercel.deploy(files);
    const record: PublishRecord = {
      deploymentId: deployment.id,
      projectId: detail.project.id,
      url: deployment.url,
      publishedAt: publishedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await this.update((records) => [...records, record]);
    return record;
  }

  async unpublish(deploymentIdOrUrl: string) {
    const vercel = this.requireVercel();
    const record = (await this.records()).find(
      (candidate) => candidate.deploymentId === deploymentIdOrUrl || candidate.url === deploymentIdOrUrl,
    );
    if (!record) {
      throw new PublishError("not-found", `Nothing published at ${deploymentIdOrUrl}`);
    }
    await vercel.remove(record.deploymentId);
    await this.update((records) => records.filter((candidate) => candidate.deploymentId !== record.deploymentId));
    return record;
  }

  async removeExpired() {
    const vercel = this.options.vercel;
    if (!vercel) {
      return [];
    }
    const now = this.options.now().getTime();
    const expired = (await this.records()).filter((record) => Date.parse(record.expiresAt) <= now);
    const removed: string[] = [];
    for (const record of expired) {
      await vercel.remove(record.deploymentId).then(
        () => removed.push(record.deploymentId),
        () => {},
      );
    }
    if (removed.length > 0) {
      await this.update((records) => records.filter((record) => !removed.includes(record.deploymentId)));
    }
    return removed;
  }

  async live(projectId: string) {
    const now = this.options.now().getTime();
    return (await this.records()).filter(
      (record) => record.projectId === projectId && Date.parse(record.expiresAt) > now,
    );
  }

  private requireVercel() {
    if (!this.options.vercel) {
      throw new PublishError("no-token", "Publishing needs a Vercel token in VERCEL_TOKEN");
    }
    return this.options.vercel;
  }

  private get filePath() {
    return path.join(this.options.stateDir, PUBLISHES_FILE);
  }

  private async records(): Promise<PublishRecord[]> {
    const text = await readFile(this.filePath, "utf8").catch(() => null);
    const parsed = publishesFileSchema.safeParse(text === null ? null : parseJson(text));
    return parsed.success ? parsed.data.publishes : [];
  }

  private async update(change: (records: PublishRecord[]) => PublishRecord[]) {
    await mkdir(this.options.stateDir, { recursive: true });
    await withFileLock(`${this.filePath}.lock`, async () => {
      const publishes = change(await this.records());
      await writeFileAtomic(this.filePath, `${JSON.stringify({ publishes }, null, 2)}\n`);
    });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
