import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ReadOnlyError } from "../readOnly.js";
import { writeFileAtomic } from "../reviews/atomicWrite.js";
import {
  AREA_MANIFEST,
  editProjectManifest,
  type ManifestEdit,
  PROJECT_MANIFEST,
  type ProjectStatus,
  type PrRef,
  samePr,
  serializeProjectManifest,
} from "./manifest.js";
import type { ProjectRecord, ProjectRegistry } from "./registry.js";

export const PROJECT_ERROR_CODES = ["invalid-id", "invalid-title", "exists", "not-found"] as const;
export const MAX_PROJECT_TITLE_LENGTH = 200;

export type ProjectErrorCode = (typeof PROJECT_ERROR_CODES)[number];

export class ProjectError extends Error {
  constructor(
    readonly code: ProjectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectError";
  }
}

export interface ProjectServiceOptions {
  docsRoot: string;
  registry: ProjectRegistry;
  readOnly: boolean;
}

export interface NewProject {
  id: string;
  title: string;
  summary: string | null;
  repos: string[];
}

const SLUG = /^[a-z0-9][a-z0-9._-]*$/i;

export class ProjectService {
  constructor(private readonly options: ProjectServiceOptions) {}

  get docsRoot() {
    return this.options.docsRoot;
  }

  async create(project: NewProject) {
    this.assertWritable();
    const segments = project.id.split("/");
    if (segments.length > 2 || !segments.every((segment) => SLUG.test(segment))) {
      throw new ProjectError("invalid-id", `"${project.id}" isn't a project id: use <project> or <area>/<project>`);
    }
    await this.options.registry.scan();
    if (this.options.registry.project(project.id)) {
      throw new ProjectError("exists", `The project ${project.id} already exists`);
    }
    const [area, slug] = segments;
    if (area && slug && this.options.registry.project(area)) {
      throw new ProjectError("invalid-id", `${area} is a project, so it can't hold other projects`);
    }
    if (area && slug) {
      await this.ensureArea(area);
    }
    const directory = path.join(this.options.docsRoot, project.id);
    await mkdir(directory, { recursive: true });
    const manifest = serializeProjectManifest({
      title: project.title,
      summary: project.summary,
      status: "active",
      repos: project.repos,
      prs: [],
      detached: [],
    });
    await writeFileAtomic(path.join(directory, PROJECT_MANIFEST), manifest);
    await this.options.registry.scan();
    return this.require(project.id);
  }

  rename(id: string, title: string) {
    const trimmed = title.trim();
    if (trimmed === "" || trimmed.length > MAX_PROJECT_TITLE_LENGTH || /[\r\n]/.test(trimmed)) {
      throw new ProjectError("invalid-title", `A title is one line of 1 to ${MAX_PROJECT_TITLE_LENGTH} characters`);
    }
    return this.edit(id, () => ({ title: trimmed }));
  }

  setStatus(id: string, status: ProjectStatus) {
    return this.edit(id, () => ({ status }));
  }

  linkPr(id: string, ref: PrRef) {
    return this.edit(id, (record) => ({
      prs: record.manifest.prs.some((known) => samePr(known, ref))
        ? record.manifest.prs
        : [...record.manifest.prs, ref],
      detached: record.manifest.detached.filter((known) => !samePr(known, ref)),
    }));
  }

  unlinkPr(id: string, ref: PrRef) {
    return this.edit(id, (record) => ({
      prs: record.manifest.prs.filter((known) => !samePr(known, ref)),
      detached: record.manifest.detached.some((known) => samePr(known, ref))
        ? record.manifest.detached
        : [...record.manifest.detached, ref],
    }));
  }

  reattachPr(id: string, ref: PrRef) {
    return this.edit(id, (record) => ({
      detached: record.manifest.detached.filter((known) => !samePr(known, ref)),
    }));
  }

  private async edit(id: string, change: (record: ProjectRecord) => ManifestEdit) {
    this.assertWritable();
    await this.options.registry.scan();
    const record = this.require(id);
    const manifestPath = path.join(this.options.docsRoot, record.id, PROJECT_MANIFEST);
    const text = await readFile(manifestPath, "utf8");
    await writeFileAtomic(manifestPath, editProjectManifest(text, change(record)));
    await this.options.registry.scan();
    return this.require(id);
  }

  private async ensureArea(area: string) {
    const areaManifest = path.join(this.options.docsRoot, area, AREA_MANIFEST);
    const existing = await readFile(areaManifest, "utf8").catch(() => null);
    if (existing === null) {
      await mkdir(path.dirname(areaManifest), { recursive: true });
      await writeFileAtomic(areaManifest, `title: ${JSON.stringify(area)}\n`);
    }
  }

  private require(id: string) {
    const record = this.options.registry.project(id);
    if (!record) {
      throw new ProjectError("not-found", `There is no project ${id}`);
    }
    return record;
  }

  private assertWritable() {
    if (this.options.readOnly) {
      throw new ReadOnlyError();
    }
  }
}
