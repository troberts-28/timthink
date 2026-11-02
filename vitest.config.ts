import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@timthink\/server\/shared$/,
        replacement: fileURLToPath(new URL("./server/src/shared.ts", import.meta.url)),
      },
      { find: /^@timthink\/server$/, replacement: fileURLToPath(new URL("./server/src/index.ts", import.meta.url)) },
    ],
  },
  test: {
    include: ["server/src/**/*.test.ts", "cli/src/**/*.test.ts", "web/src/**/*.test.ts"],
    environment: "node",
    testTimeout: 15_000,
  },
});
