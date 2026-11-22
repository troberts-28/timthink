import { createHash } from "node:crypto";
import type { ExportFile } from "./projectExport.js";

const VERCEL_API = "https://api.vercel.com";
export const PUBLISH_PROJECT_NAME = "timthink-pages";
const STATIC_PROJECT_SETTINGS = {
  framework: null,
  buildCommand: null,
  installCommand: null,
  devCommand: null,
  outputDirectory: null,
};
const PLACEHOLDER_HTML = '<!doctype html><meta name="robots" content="noindex"><title>Nothing here</title>\n';

export interface VercelDeployment {
  id: string;
  url: string;
}

export interface VercelClientOptions {
  token: string;
  fetch: typeof fetch;
}

export class VercelError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VercelError";
  }
}

export class VercelClient {
  private teamId: Promise<string | null> | null = null;

  constructor(private readonly options: VercelClientOptions) {}

  async deploy(files: readonly ExportFile[]): Promise<VercelDeployment> {
    await this.ensureProject();
    return this.createDeployment(files, "preview");
  }

  async remove(deploymentId: string) {
    const response = await this.request(`/v13/deployments/${encodeURIComponent(deploymentId)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      throw await vercelError(response, "Deleting the deployment failed");
    }
  }

  private async ensureProject() {
    const project = `/v9/projects/${PUBLISH_PROJECT_NAME}`;
    const existing = await this.request(project, { method: "GET" });
    if (existing.status === 404) {
      const created = await this.json("/v11/projects", { name: PUBLISH_PROJECT_NAME, ...STATIC_PROJECT_SETTINGS });
      if (!created.ok) {
        throw await vercelError(created, "Creating the Vercel project failed");
      }
      await this.makePublic(project);
      await this.createDeployment([{ path: "index.html", data: Buffer.from(PLACEHOLDER_HTML) }], "production");
      return;
    }
    if (!existing.ok) {
      throw await vercelError(existing, "Reading the Vercel project failed");
    }
    const body: unknown = await existing.json();
    if (isObject(body) && body.ssoProtection !== null && body.ssoProtection !== undefined) {
      await this.makePublic(project);
    }
  }

  private async makePublic(project: string) {
    const response = await this.json(project, { ssoProtection: null }, "PATCH");
    if (!response.ok) {
      throw await vercelError(response, "Turning off Vercel Authentication for the project failed");
    }
  }

  private async createDeployment(files: readonly ExportFile[], target: "preview" | "production") {
    const uploaded = await Promise.all(files.map((file) => this.upload(file)));
    const response = await this.json("/v13/deployments?skipAutoDetectionConfirmation=1", {
      name: PUBLISH_PROJECT_NAME,
      project: PUBLISH_PROJECT_NAME,
      ...(target === "production" ? { target } : {}),
      files: uploaded,
      projectSettings: STATIC_PROJECT_SETTINGS,
    });
    if (!response.ok) {
      throw await vercelError(response, "Creating the deployment failed");
    }
    const body: unknown = await response.json();
    if (!isObject(body) || typeof body.id !== "string" || typeof body.url !== "string") {
      throw new VercelError("Vercel's deployment response had no id or url", response.status);
    }
    return { id: body.id, url: `https://${body.url}` };
  }

  private async upload(file: ExportFile) {
    const sha = createHash("sha1").update(file.data).digest("hex");
    const response = await this.request("/v2/files", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-vercel-digest": sha,
        "x-now-digest": sha,
        "x-now-size": String(file.data.length),
      },
      body: new Uint8Array(file.data),
    });
    if (!response.ok) {
      throw await vercelError(response, `Uploading ${file.path} failed`);
    }
    return { file: file.path, sha, size: file.data.length };
  }

  private json(apiPath: string, body: unknown, method = "POST") {
    return this.request(apiPath, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async request(apiPath: string, init: RequestInit) {
    const url = new URL(`${VERCEL_API}${apiPath}`);
    const teamId = await this.defaultTeamId();
    if (teamId) {
      url.searchParams.set("teamId", teamId);
    }
    return this.authorized(url, init);
  }

  private defaultTeamId() {
    this.teamId ??= this.authorized(new URL(`${VERCEL_API}/v2/user`), { method: "GET" }).then(async (response) => {
      if (!response.ok) {
        throw await vercelError(response, "Reading the Vercel account failed");
      }
      const body: unknown = await response.json();
      const user = isObject(body) && isObject(body.user) ? body.user : null;
      return typeof user?.defaultTeamId === "string" ? user.defaultTeamId : null;
    });
    return this.teamId;
  }

  private authorized(url: URL, init: RequestInit) {
    return this.options.fetch(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${this.options.token}` },
    });
  }
}

async function vercelError(response: Response, context: string) {
  const body: unknown = await response.json().catch(() => null);
  const message =
    isObject(body) && isObject(body.error) && typeof body.error.message === "string" ? body.error.message : null;
  return new VercelError(`${context} (${response.status})${message ? `: ${message}` : ""}`, response.status);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
