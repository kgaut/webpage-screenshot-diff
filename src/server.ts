import express from "express";
import { closeBrowser } from "./capture.js";
import { loadConfig } from "./config.js";
import { makeDiffHandler } from "./routes/diff.js";
import { healthHandler } from "./routes/health.js";
import { buildPaths, ensureLayout } from "./storage.js";

const log = (level: string, msg: string, extra?: object): void => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  process.stdout.write(`${line}\n`);
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  await ensureLayout(buildPaths(config.dataDir));

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/healthz", healthHandler);
  app.post("/diff", makeDiffHandler(config));

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log("error", "unhandled_error", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "internal_error", message: err.message });
  });

  const server = app.listen(config.port, () => {
    log("info", "server_started", { port: config.port, dataDir: config.dataDir });
  });

  const shutdown = async (signal: string): Promise<void> => {
    log("info", "shutdown_requested", { signal });
    server.close();
    await closeBrowser();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};

main().catch((err) => {
  log("error", "startup_failed", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
