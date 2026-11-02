import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

const VITE_DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

const config = loadConfig();
const running = await startServer({
  config,
  webDist: null,
  extraOrigins: VITE_DEV_ORIGINS,
  log: (message) => console.log(`[timthink] ${message}`),
});
console.log(`[timthink] api on ${running.url} (docsRoot ${config.docsRoot}); open http://localhost:5173`);

const shutdown = (): void => {
  void running.close().then(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
