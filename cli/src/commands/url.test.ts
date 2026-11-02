import { describe, expect, it } from "vitest";
import { DocOutsideRootError, docUrl } from "./url.js";

const config = { docsRoot: "/docs", port: 7420 };

describe("docUrl", () => {
  it("accepts absolute and docsRoot-relative paths", () => {
    expect(docUrl(config, "/docs/acme/2026-10-01-plan.md")).toBe("http://127.0.0.1:7420/d/acme/2026-10-01-plan.md");
    expect(docUrl(config, "acme/sub folder/plan.md")).toBe("http://127.0.0.1:7420/d/acme/sub%20folder/plan.md");
  });

  it("rejects paths outside docsRoot", () => {
    expect(() => docUrl(config, "/elsewhere/plan.md")).toThrow(DocOutsideRootError);
    expect(() => docUrl(config, "../plan.md")).toThrow(DocOutsideRootError);
  });
});
