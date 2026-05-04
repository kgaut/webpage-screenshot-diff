import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { closeBrowser } from "./capture.js";
import { loadConfig } from "./config.js";
import { makeApiRouter } from "./routes/api.js";
import { makeDiffHandler } from "./routes/diff.js";
import { healthHandler } from "./routes/health.js";
import { ensureRoot } from "./storage.js";

const log = (level: string, msg: string, extra?: object): void => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  process.stdout.write(`${line}\n`);
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolveWebDir = async (): Promise<string | null> => {
  const candidates = [
    process.env.WEB_DIST_DIR,
    path.resolve(__dirname, "../web/dist"),
    path.resolve(__dirname, "../../web/dist"),
  ].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, "index.html"));
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  await ensureRoot(config.dataDir);

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/healthz", healthHandler);
  app.post("/diff", makeDiffHandler(config));
  app.use("/api", makeApiRouter(config));

  const webDir = await resolveWebDir();
  if (webDir) {
    app.use(express.static(webDir));
    app.get(/^\/(?!api|diff|healthz).*/, (_req, res) => {
      res.sendFile(path.join(webDir, "index.html"));
    });
    log("info", "web_ui_enabled", { webDir });
  } else {
    log("warn", "web_ui_missing", { hint: "build the SPA in web/dist or set WEB_DIST_DIR" });
  }

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
