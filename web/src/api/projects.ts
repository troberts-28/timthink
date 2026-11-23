import type {
  AppType,
  AreaDetail,
  AuthoredPageView,
  ChecklistResults,
  ProjectDetail,
  ProjectStatus,
  PublishRecord,
  StepResult,
} from "@timthink/server";
import { hc } from "hono/client";
import { NotFoundError, sessionToken, TOKEN_HEADER } from "./client";

const client = hc<AppType>("/");

export type ProjectPrAction = "link" | "unlink" | "reattach";

export interface ProjectPrChange {
  id: string;
  repo: string;
  number: number;
  action: ProjectPrAction;
}

export async function fetchProject(id: string): Promise<ProjectDetail> {
  const response = await client.api.project.$get({ query: { id } });
  if (response.status === 404) {
    throw new NotFoundError(id);
  }
  if (!response.ok) {
    throw new Error(`Project request failed (${response.status})`);
  }
  const detail: ProjectDetail = await response.json();
  return detail;
}

export async function fetchProjectPage(id: string): Promise<AuthoredPageView> {
  const response = await client.api.project.page.$get({ query: { id } });
  if (!response.ok) {
    throw new Error(`Project page request failed (${response.status})`);
  }
  const page: AuthoredPageView = await response.json();
  return page;
}

export async function fetchArea(id: string): Promise<AreaDetail> {
  const response = await client.api.area.$get({ query: { id } });
  if (response.status === 404) {
    throw new NotFoundError(id);
  }
  if (!response.ok) {
    throw new Error(`Area request failed (${response.status})`);
  }
  const detail: AreaDetail = await response.json();
  return detail;
}

export async function fetchAreaPage(id: string): Promise<AuthoredPageView> {
  const response = await client.api.area.page.$get({ query: { id } });
  if (!response.ok) {
    throw new Error(`Area page request failed (${response.status})`);
  }
  const page: AuthoredPageView = await response.json();
  return page;
}

export async function fetchChecklist(id: string, checklist: string): Promise<ChecklistResults> {
  const response = await client.api.project.checklist.$get({ query: { id, checklist } });
  if (!response.ok) {
    throw new Error(`Checklist request failed (${response.status})`);
  }
  const results: ChecklistResults = await response.json();
  return results;
}

export interface StepChange {
  id: string;
  checklist: string;
  step: string;
  result: Omit<StepResult, "at"> | null;
}

export async function recordStep(change: StepChange): Promise<ChecklistResults> {
  const token = await sessionToken();
  const response = await client.api.project.checklist.$post({ json: change }, { headers: { [TOKEN_HEADER]: token } });
  if (!response.ok) {
    throw new Error(`Couldn't save the step (${response.status})`);
  }
  const results: ChecklistResults = await response.json();
  return results;
}

export async function changeProjectPr(change: ProjectPrChange) {
  const token = await sessionToken();
  const response = await client.api.project.pr.$post({ json: change }, { headers: { [TOKEN_HEADER]: token } });
  if (!response.ok) {
    throw new Error(`Couldn't update the project's PRs (${response.status})`);
  }
}

export async function setProjectStatus(id: string, status: ProjectStatus) {
  const token = await sessionToken();
  const response = await client.api.project.status.$post(
    { json: { id, status } },
    { headers: { [TOKEN_HEADER]: token } },
  );
  if (!response.ok) {
    throw new Error(`Couldn't change the project's status (${response.status})`);
  }
}

export async function settlePlanCompletion(docPath: string, done: boolean) {
  const token = await sessionToken();
  const response = await client.api["doc-prs"].complete.$post(
    { json: { path: docPath, done } },
    { headers: { [TOKEN_HEADER]: token } },
  );
  if (!response.ok) {
    throw new Error(`Couldn't update the plan (${response.status})`);
  }
}

export interface PublishesView {
  canPublish: boolean;
  publishes: PublishRecord[];
}

export async function fetchPublishes(project: string): Promise<PublishesView> {
  const response = await client.api.publish.$get({ query: { project } });
  if (!response.ok) {
    throw new Error(`Publishes request failed (${response.status})`);
  }
  const view: PublishesView = await response.json();
  return view;
}

export async function publishProject(project: string, ttlHours: number): Promise<PublishRecord> {
  const token = await sessionToken();
  const response = await client.api.publish.$post(
    { json: { project, ttlHours } },
    { headers: { [TOKEN_HEADER]: token } },
  );
  if (!response.ok) {
    throw new Error(await failureMessage(response, "Publishing failed"));
  }
  const record: PublishRecord = await response.json();
  return record;
}

export async function unpublishProject(deploymentId: string) {
  const token = await sessionToken();
  const response = await client.api.publish.unpublish.$post(
    { json: { deploymentId } },
    { headers: { [TOKEN_HEADER]: token } },
  );
  if (!response.ok) {
    throw new Error(await failureMessage(response, "Unpublishing failed"));
  }
}

async function failureMessage(response: { status: number; json(): Promise<unknown> }, fallback: string) {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return `${fallback} (${response.status})`;
}

export async function renameProject(id: string, title: string) {
  const token = await sessionToken();
  const response = await client.api.project.title.$post(
    { json: { id, title } },
    { headers: { [TOKEN_HEADER]: token } },
  );
  if (!response.ok) {
    throw new Error(await failureMessage(response, "Couldn't rename the project"));
  }
}

export async function renameDoc(docPath: string, title: string) {
  const token = await sessionToken();
  const response = await client.api.doc.title.$post(
    { json: { path: docPath, title } },
    { headers: { [TOKEN_HEADER]: token } },
  );
  if (!response.ok) {
    throw new Error(await failureMessage(response, "Couldn't rename the plan"));
  }
}
