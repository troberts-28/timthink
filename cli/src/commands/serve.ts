import { startServer, type TimthinkConfig } from "@timthink/server";

export async function serve(config: TimthinkConfig): Promise<void> {
  const running = await startServer({
    config,
    log: (message) => console.log(`[timthink] ${message}`),
  });
  console.log(`timthink is serving ${config.docsRoot} at ${running.url}`);
  const shutdown = (): void => {
    void running.close().then(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
