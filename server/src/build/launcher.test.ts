import { describe, expect, it } from "vitest";
import { launchArgv } from "./launcher.js";

describe("launchArgv", () => {
  it("fills placeholders without a shell, so values stay single arguments", () => {
    expect(
      launchArgv(
        ["/bin/work", "{branch}", "--prompt", "{prompt}", "--doc={doc}"],
        { doc: "repo/my plan.md", phase: 2 },
        "feat/x",
      ),
    ).toEqual([
      "/bin/work",
      "feat/x",
      "--prompt",
      '/timthink build "repo/my plan.md" --phase 2',
      "--doc=repo/my plan.md",
    ]);
  });
});
