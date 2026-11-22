import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCheck } from "./check.js";

const PAGE = `import { Callout, Checklist, KvTable, Mermaid, QrLink, Section, Step, useProject } from "timthink/page";
import { Seeds } from "../kit/Seeds";

export default function Page() {
  const { project } = useProject();
  return (
    <Section id="setup" title={project.title}>
      <Callout tone="tip">Seed first.</Callout>
      <Seeds />
      <KvTable rows={{ Gate: "annual_payments" }} />
      <Mermaid id="flow" code="flowchart LR; A-->B" />
      <QrLink id="phone" href="http://192.168.1.20:3002/login?token=abc" />
      <Checklist id="smoke" pr={7}>
        <Step id="pay">Pay annually</Step>
      </Checklist>
    </Section>
  );
}
`;

const AREA_PAGE = `import { Checklist, Section, Step, useArea } from "timthink/page";

export default function Page() {
  const { area } = useArea();
  return (
    <Section id="households" title={area.title}>
      <Checklist id="smoke">
        <Step id="seed">Seed a household</Step>
      </Checklist>
    </Section>
  );
}
`;

const KIT = `import { CopyCommand } from "timthink/page";
export function Seeds() {
  return <CopyCommand id="seed" command="yarn seed" />;
}
`;

async function setup() {
  const docsRoot = await mkdtemp(path.join(tmpdir(), "timthink-page-"));
  await mkdir(path.join(docsRoot, "payments", "checkout"), { recursive: true });
  await mkdir(path.join(docsRoot, "payments", "kit"), { recursive: true });
  await writeFile(path.join(docsRoot, "payments", "area.yaml"), "title: Payments\n");
  await writeFile(path.join(docsRoot, "payments", "checkout", "project.yaml"), "title: Checkout\n");
  await writeFile(path.join(docsRoot, "payments", "kit", "Seeds.tsx"), KIT);
  const pageFile = path.join(docsRoot, "payments", "checkout", "project.page.tsx");
  const output: string[] = [];
  const io = { out: (text: string) => output.push(text), err: (text: string) => output.push(`ERR ${text}`) };
  const check = async (source: string) => {
    output.length = 0;
    await writeFile(pageFile, source);
    return runCheck({ docsRoot }, pageFile, io);
  };
  return { check, output, docsRoot, io };
}

describe("timthink check on a project page", () => {
  it("compiles and renders a page with local imports", async () => {
    const { check, output } = await setup();
    expect(await check(PAGE)).toBe(0);
    expect(output).toEqual(["No problems found."]);
  });

  it("fails on compile errors, render errors and duplicate block ids", async () => {
    const { check, output } = await setup();
    expect(await check(PAGE.replace("</Section>", "</Sectio>"))).toBe(1);
    expect(output[0]).toMatch(/project\.page\.tsx:\d+:\d+: error: /);

    expect(await check(PAGE.replace("<Seeds />", "{project.docs[0].title}"))).toBe(1);
    expect(output[0]).toContain("error: The page failed to render");

    expect(await check(PAGE.replace('id="flow"', 'id="setup"'))).toBe(1);
    expect(output[0]).toContain('Block id "setup" is used more than once');
  });

  it("checks an area page against a stub area", async () => {
    const { docsRoot, io, output } = await setup();
    const areaPage = path.join(docsRoot, "payments", "area.page.tsx");
    await writeFile(areaPage, AREA_PAGE);
    expect(await runCheck({ docsRoot }, areaPage, io)).toBe(0);
    expect(output).toEqual(["No problems found."]);

    output.length = 0;
    await writeFile(areaPage, AREA_PAGE.replace("useArea()", "useProject()").replace("useArea }", "useProject }"));
    expect(await runCheck({ docsRoot }, areaPage, io)).toBe(1);
    expect(output[0]).toContain("useProject only works inside a project page");
  });
});
