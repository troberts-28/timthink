import { describe, expect, it } from "vitest";
import { FrontmatterEditError, setFrontmatterStatus } from "./frontmatterStatus.js";

describe("setFrontmatterStatus", () => {
  it("replaces only the status value, keeping comments, order and spacing", () => {
    const raw = "---\ntitle: Plan # main title\nstatus:   review  # waiting on Sam\ntags: [a, b]\n---\n\n# Plan\n";
    expect(setFrontmatterStatus(raw, "approved")).toBe(
      "---\ntitle: Plan # main title\nstatus:   approved  # waiting on Sam\ntags: [a, b]\n---\n\n# Plan\n",
    );
  });

  it("replaces quoted values", () => {
    expect(setFrontmatterStatus("---\nstatus: 'review'\n---\nbody", "draft")).toBe("---\nstatus: draft\n---\nbody");
  });

  it("inserts a status line before the closing delimiter when missing", () => {
    expect(setFrontmatterStatus("---\ntitle: Plan\n---\nbody\n", "approved")).toBe(
      "---\ntitle: Plan\nstatus: approved\n---\nbody\n",
    );
    expect(setFrontmatterStatus("---\n---\nbody", "draft")).toBe("---\nstatus: draft\n---\nbody");
  });

  it("adds a frontmatter block when there is none", () => {
    expect(setFrontmatterStatus("# Plan\n\nBody.\n", "draft")).toBe("---\nstatus: draft\n---\n\n# Plan\n\nBody.\n");
    expect(setFrontmatterStatus("", "draft")).toBe("---\nstatus: draft\n---\n");
  });

  it("preserves CRLF line endings and a BOM", () => {
    const raw = "﻿---\r\ntitle: Plan\r\nstatus: review\r\n---\r\nBody\r\n";
    expect(setFrontmatterStatus(raw, "approved")).toBe("﻿---\r\ntitle: Plan\r\nstatus: approved\r\n---\r\nBody\r\n");
    expect(setFrontmatterStatus("---\r\ntitle: Plan\r\n---\r\nBody", "draft")).toBe(
      "---\r\ntitle: Plan\r\nstatus: draft\r\n---\r\nBody",
    );
    expect(setFrontmatterStatus("# Plan\r\n", "draft")).toBe("---\r\nstatus: draft\r\n---\r\n\r\n# Plan\r\n");
  });

  it("handles a file that ends right after the closing delimiter", () => {
    expect(setFrontmatterStatus("---\nstatus: review\n---", "approved")).toBe("---\nstatus: approved\n---");
  });

  it("leaves nested status keys alone", () => {
    const raw = "---\nmeta:\n  status: x\n---\n";
    expect(setFrontmatterStatus(raw, "draft")).toBe("---\nmeta:\n  status: x\nstatus: draft\n---\n");
  });

  it.each([
    ["malformed YAML", "---\ntitle: [unclosed\n---\nbody"],
    ["an unclosed block", "---\ntitle: Plan\nbody without end\n"],
    ["duplicate status keys", "---\nstatus: a\nstatus: b\n---\n"],
    ["a block scalar status", "---\nstatus: |\n  review\n---\n"],
    ["a non-mapping block", "---\n- a\n- b\n---\n"],
  ])("refuses %s instead of corrupting the file", (_name, raw) => {
    expect(() => setFrontmatterStatus(raw, "approved")).toThrow(FrontmatterEditError);
  });

  it("rejects invalid status values", () => {
    expect(() => setFrontmatterStatus("body", "Approved: yes")).toThrow(FrontmatterEditError);
  });
});
