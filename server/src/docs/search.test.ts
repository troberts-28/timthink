import { describe, expect, it } from "vitest";
import { parseSearchQuery, searchDocs } from "./search.js";
import type { DocSummary } from "./types.js";

function doc(path: string, title: string, status: string | null, text: string, mtime = 0) {
  const [repo = ""] = path.split("/");
  return { summary: { path, title, repo, status, mtime } as DocSummary, text };
}

describe("searchDocs", () => {
  const docs = [
    doc(
      "api/a.md",
      "Rate limiter",
      "in-progress",
      "Use a token bucket per client. The bucket refills one token a second.",
    ),
    doc("api/b.md", "Billing", "done", "Mentions the token once.", 5),
    doc("web/c.md", "Token refresh UI", "draft", "Nothing else here."),
  ];

  it("matches every term in the title or body and ranks title hits first", () => {
    expect(searchDocs(docs, "token", 10).map((hit) => hit.path)).toEqual(["web/c.md", "api/a.md", "api/b.md"]);
    expect(searchDocs(docs, "token bucket", 10).map((hit) => hit.path)).toEqual(["api/a.md"]);
  });

  it("filters by repo and by status, mapping synonyms", () => {
    expect(searchDocs(docs, "token repo:api", 10).map((hit) => hit.path)).toEqual(["api/a.md", "api/b.md"]);
    expect(searchDocs(docs, "status:complete", 10).map((hit) => hit.path)).toEqual(["api/b.md"]);
  });

  it("returns a snippet around the first body match", () => {
    const [hit] = searchDocs(docs, "refills", 10);
    expect(hit?.snippet).toContain("The bucket refills one token");
  });

  it("parses filters out of the terms", () => {
    expect(parseSearchQuery("Repo:API status:wip foo")).toEqual({ terms: ["foo"], repo: "api", status: "in-progress" });
  });
});
