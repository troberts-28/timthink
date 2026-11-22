import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProjectDetail } from "../projects/projectView.js";
import { createRuntime, type Runtime } from "../server.js";
import { copyFixtureDocs, makeTempDir, testConfig } from "../test/fixtures.js";
import { EXPORT_DATA_ELEMENT_ID, type ProjectExport } from "./exportData.js";
import { buildProjectExport } from "./projectExport.js";
import { PublishError, Publisher } from "./publisher.js";
import { VercelClient } from "./vercel.js";

const BASE = "http://127.0.0.1:7420";
const CHECKOUT_ID = "payments/checkout-v2";
const PUBLISHED_AT = new Date("2026-11-22T10:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = `import { Checklist, Section, Step } from "timthink/page";
export default () => (
  <Section id="how-to-test" title="How to test">
    Seed a household with saved cards.
    <Checklist id="smoke"><Step id="pay">Pay with a saved card</Step></Checklist>
  </Section>
);
`;

describe("publishing a project", () => {
  let docsRoot: string;
  let webDist: string;
  let detail: ProjectDetail;

  beforeEach(async () => {
    docsRoot = await copyFixtureDocs();
    await writeFile(path.join(docsRoot, CHECKOUT_ID, "project.page.tsx"), PAGE);
    webDist = await makeTempDir();
    await mkdir(path.join(webDist, "assets"));
    await writeFile(path.join(webDist, "assets", "index-abc.css"), "@font-face{src:url(/assets/inter-x.woff2)}");
    await writeFile(path.join(webDist, "assets", "inter-x.woff2"), "font");
    const runtime: Runtime = await createRuntime({ config: testConfig({ docsRoot }), webDist: null });
    detail = await (await runtime.app.request(`${BASE}/api/project?id=${encodeURIComponent(CHECKOUT_ID)}`)).json();
  });

  it("exports the page, PRs and every doc body, without the owner's sessions or rounds", async () => {
    const files = await buildProjectExport({
      docsRoot,
      webDist,
      detail: { ...detail, rounds: [], sessions: [{ ...sessionView(), title: "Private session" }] },
      checklists: {
        smoke: { steps: { pay: { outcome: "pass", note: "", at: PUBLISHED_AT.toISOString(), sha: null } } },
      },
      publishedAt: PUBLISHED_AT,
      expiresAt: new Date(PUBLISHED_AT.getTime() + DAY_MS),
    });
    const byPath = new Map(files.map((file) => [file.path, file.data.toString("utf8")]));
    expect([...byPath.keys()]).toEqual(
      expect.arrayContaining(["index.html", "app.js", "middleware.js", "assets/index-abc.css", "assets/inter-x.woff2"]),
    );
    expect(byPath.get("app.js")).toContain("Seed a household with saved cards.");
    expect(byPath.get("middleware.js")).toContain(String(PUBLISHED_AT.getTime() + DAY_MS));

    const data = exportData(byPath.get("index.html") ?? "");
    expect(data.docs.map((doc) => doc.path).sort()).toEqual(detail.project.docs.map((doc) => doc.path).sort());
    expect(data.docs.every((doc) => doc.raw.length > 0)).toBe(true);
    expect(data.detail.sessions).toEqual([]);
    expect(data.checklists.smoke?.steps.pay?.outcome).toBe("pass");
    expect(data.expiresAt).toBe("2026-11-23T10:00:00.000Z");
  });

  it("publishes to Vercel, removes the deployment once it expires, and unpublishes on request", async () => {
    const vercel = fakeVercel();
    let now = PUBLISHED_AT;
    const publisher = new Publisher({
      docsRoot,
      stateDir: await makeTempDir(),
      webDist,
      vercel: new VercelClient({ token: "test-token", fetch: vercel.fetch }),
      now: () => now,
    });
    const request = { detail, checklists: {}, ttlMs: DAY_MS };

    const first = await publisher.publish(request);
    expect(first).toMatchObject({ deploymentId: "dpl_2", projectId: CHECKOUT_ID, url: "https://deploy-2.vercel.app" });
    expect(vercel.calls.filter((call) => !call.startsWith("POST /v2/files"))).toEqual([
      "GET /v2/user",
      "GET /v9/projects/timthink-pages?teamId=team_1",
      "POST /v11/projects?teamId=team_1",
      "PATCH /v9/projects/timthink-pages?teamId=team_1",
      "POST /v13/deployments?skipAutoDetectionConfirmation=1&teamId=team_1",
      "POST /v13/deployments?skipAutoDetectionConfirmation=1&teamId=team_1",
    ]);
    expect(vercel.deployments.map((deployment) => deployment.target ?? "preview")).toEqual(["production", "preview"]);
    expect(await publisher.live(CHECKOUT_ID)).toEqual([first]);

    now = new Date(PUBLISHED_AT.getTime() + DAY_MS);
    expect(await publisher.live(CHECKOUT_ID)).toEqual([]);
    expect(await publisher.removeExpired()).toEqual(["dpl_2"]);
    expect(vercel.calls.at(-1)).toBe("DELETE /v13/deployments/dpl_2?teamId=team_1");

    const second = await publisher.publish(request);
    await publisher.unpublish(second.url);
    expect(vercel.calls.at(-1)).toBe(`DELETE /v13/deployments/${second.deploymentId}?teamId=team_1`);
    expect(await publisher.live(CHECKOUT_ID)).toEqual([]);
    await expect(publisher.publish({ ...request, ttlMs: 90 * DAY_MS + 1 })).rejects.toMatchObject({
      code: "invalid-ttl",
    });
  });

  it("refuses to publish without a Vercel token", async () => {
    const publisher = new Publisher({
      docsRoot,
      stateDir: await makeTempDir(),
      webDist,
      vercel: null,
      now: () => PUBLISHED_AT,
    });
    expect(publisher.canPublish).toBe(false);
    await expect(publisher.publish({ detail, checklists: {}, ttlMs: DAY_MS })).rejects.toBeInstanceOf(PublishError);
  });
});

function exportData(html: string): ProjectExport {
  const match = new RegExp(`<script type="application/json" id="${EXPORT_DATA_ELEMENT_ID}">(.*?)</script>`, "s").exec(
    html,
  );
  return JSON.parse(match?.[1] ?? "null");
}

function sessionView(): ProjectDetail["sessions"][number] {
  return {
    id: "s",
    title: "Session",
    cwd: "/Users/me/code",
    branch: null,
    firstSeen: null,
    lastActivity: null,
    live: true,
    status: "working",
    warpFocusUrl: null,
    canResume: true,
    mayBeOpenUntracked: false,
    wroteDoc: null,
    plannedDoc: null,
    builtDoc: null,
  };
}

function fakeVercel() {
  const calls: string[] = [];
  const deployments: Array<{ target?: string }> = [];
  let projectExists = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const call = `${method} ${url.pathname}${url.search}`;
    calls.push(call);
    if (call === "GET /v2/user") {
      return Response.json({ user: { defaultTeamId: "team_1" } });
    }
    if (call === "GET /v9/projects/timthink-pages?teamId=team_1") {
      return projectExists ? Response.json({ ssoProtection: null }) : Response.json({}, { status: 404 });
    }
    if (call === "POST /v11/projects?teamId=team_1") {
      projectExists = true;
      return Response.json({ id: "prj_1" });
    }
    if (url.pathname.startsWith("/v13/deployments") && method === "POST") {
      deployments.push(JSON.parse(String(init?.body)));
      return Response.json({ id: `dpl_${deployments.length}`, url: `deploy-${deployments.length}.vercel.app` });
    }
    return Response.json({});
  };
  return { fetch, calls, deployments };
}
