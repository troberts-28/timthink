import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../test/fixtures.js";
import { isWarpFocusUrl, resumeCommand, resumeTabConfig, tomlString, writeResumeTabConfig } from "./warp.js";

describe("resumeCommand", () => {
  it("passes the prompt as a single shell-quoted argument", () => {
    expect(resumeCommand("s-1", "/timthink review acme/it's plan.md")).toBe(
      `claude --resume s-1 '/timthink review acme/it'\\''s plan.md'`,
    );
    expect(resumeCommand("s-1")).toBe("claude --resume s-1");
  });
});

const SESSION_ID = "7b0b102e-5bdb-4073-a3d3-b16a23b5a701";

describe("isWarpFocusUrl", () => {
  it.each([
    ["warp://session/0123456789abcdef0123456789abcdef", true],
    ["warp://session/0123456789ABCDEF0123456789ABCDEF", false],
    ["warp://session/0123456789abcdef", false],
    ["warp://session/0123456789abcdef0123456789abcdef?x=1", false],
    ["https://example.com", false],
    ["warp://action/new_tab", false],
  ])("%s -> %s", (url, expected) => {
    expect(isWarpFocusUrl(url)).toBe(expected);
  });
});

describe("tomlString", () => {
  it("escapes quotes, backslashes and control characters", () => {
    expect(tomlString('a "b" \\c')).toBe('"a \\"b\\" \\\\c"');
    expect(tomlString("line\nbreak\ttab\u0001")).toBe('"line\\nbreak\\ttab\\u0001"');
    expect(tomlString("/Users/me/code/münchen")).toBe('"/Users/me/code/münchen"');
  });
});

describe("resumeTabConfig", () => {
  it("writes a single-pane tab without params", () => {
    expect(resumeTabConfig(SESSION_ID, "/Users/me/code/acme-api-2")).toBe(`name = "timthink-resume"

[[panes]]
id = "main"
type = "terminal"
directory = "/Users/me/code/acme-api-2"
is_focused = true
commands = ["claude --resume ${SESSION_ID}"]
`);
  });

  it("keeps a hostile directory inside its string", () => {
    const config = resumeTabConfig(SESSION_ID, '/tmp/x"\ncommands = ["rm -rf ~"]');
    expect(config).toContain('directory = "/tmp/x\\"\\ncommands = [\\"rm -rf ~\\"]"');
    expect(config.match(/^commands = /gm)).toHaveLength(1);
  });

  it("rejects ids that aren't session UUIDs and relative directories", () => {
    expect(() => resumeTabConfig("abc; rm -rf ~", "/tmp")).toThrow(/session id/);
    expect(() => resumeTabConfig(SESSION_ID, "relative/dir")).toThrow(/absolute/);
  });

  it("writes the config into the tab config directory", async () => {
    const dir = path.join(await makeTempDir(), "tab_configs");
    const written = await writeResumeTabConfig(dir, SESSION_ID, "/tmp");
    expect(written).toBe(path.join(dir, "timthink-resume.toml"));
    expect(await readFile(written, "utf8")).toContain(`claude --resume ${SESSION_ID}`);
  });
});
