import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isIgnoredName } from "../docs/store.js";
import {
  AREA_MANIFEST,
  type AreaManifest,
  isManifestPath,
  PROJECT_MANIFEST,
  type ProjectManifest,
  parseAreaManifest,
  parseProjectManifest,
} from "./manifest.js";

export interface ProjectRecord {
  id: string;
  area: string | null;
  slug: string;
  manifest: ProjectManifest;
  problems: string[];
}

export interface AreaRecord {
  id: string;
  manifest: AreaManifest;
  problems: string[];
  projectIds: string[];
}

export function affectsProjects(relPaths: readonly string[]) {
  return relPaths.some((relPath) => isManifestPath(relPath) || !relPath.includes("/"));
}

export class ProjectRegistry {
  private areaRecords = new Map<string, AreaRecord>();
  private projectRecords = new Map<string, ProjectRecord>();
  private fingerprint = "";

  constructor(readonly docsRoot: string) {}

  async scan() {
    const areas = new Map<string, AreaRecord>();
    const projects = new Map<string, ProjectRecord>();
    for (const top of await this.childDirs(this.docsRoot)) {
      const projectText = await this.readManifest(top, PROJECT_MANIFEST);
      const areaText = await this.readManifest(top, AREA_MANIFEST);
      if (projectText !== null) {
        const parsed = parseProjectManifest(projectText);
        const problems =
          areaText === null ? parsed.problems : [...parsed.problems, `has an ${AREA_MANIFEST} too; read as a project`];
        projects.set(top, { id: top, area: null, slug: top, manifest: parsed.manifest, problems });
        continue;
      }
      if (areaText === null) {
        continue;
      }
      const area = parseAreaManifest(areaText);
      const projectIds: string[] = [];
      for (const slug of await this.childDirs(path.join(this.docsRoot, top))) {
        const childText = await this.readManifest(`${top}/${slug}`, PROJECT_MANIFEST);
        if (childText === null) {
          continue;
        }
        const parsed = parseProjectManifest(childText);
        const repos = parsed.manifest.repos.length > 0 ? parsed.manifest.repos : area.manifest.repos;
        const id = `${top}/${slug}`;
        projects.set(id, { id, area: top, slug, manifest: { ...parsed.manifest, repos }, problems: parsed.problems });
        projectIds.push(id);
      }
      areas.set(top, { id: top, manifest: area.manifest, problems: area.problems, projectIds });
    }
    const fingerprint = JSON.stringify([[...areas], [...projects]]);
    const changed = fingerprint !== this.fingerprint;
    this.areaRecords = areas;
    this.projectRecords = projects;
    this.fingerprint = fingerprint;
    return changed;
  }

  areas() {
    return [...this.areaRecords.values()];
  }

  projects() {
    return [...this.projectRecords.values()];
  }

  area(id: string) {
    return this.areaRecords.get(id);
  }

  project(id: string) {
    return this.projectRecords.get(id);
  }

  isManagedRoot(top: string) {
    return this.areaRecords.has(top) || this.projectRecords.has(top);
  }

  projectForPath(relPath: string) {
    const [top = "", slug = ""] = relPath.split("/");
    const standalone = this.projectRecords.get(top);
    if (standalone) {
      return standalone;
    }
    const nested = this.areaRecords.has(top) ? this.projectRecords.get(`${top}/${slug}`) : undefined;
    return nested && relPath.startsWith(`${nested.id}/`) ? nested : null;
  }

  areaForPath(relPath: string) {
    return this.areaRecords.get(relPath.split("/")[0] ?? "") ?? null;
  }

  codeRepos() {
    const names = new Set<string>();
    for (const project of this.projectRecords.values()) {
      for (const repo of project.manifest.repos) {
        names.add(repo);
      }
      for (const pr of [...project.manifest.prs, ...project.manifest.detached]) {
        names.add(pr.repo);
      }
    }
    for (const area of this.areaRecords.values()) {
      for (const repo of area.manifest.repos) {
        names.add(repo);
      }
    }
    return [...names];
  }

  private async childDirs(absolute: string) {
    const entries = await readdir(absolute, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isDirectory() && !isIgnoredName(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  }

  private readManifest(relDir: string, fileName: string) {
    return readFile(path.join(this.docsRoot, relDir, fileName), "utf8").catch(() => null);
  }
}
