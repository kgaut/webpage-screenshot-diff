import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import type { TokenStore } from "./auth.js";
import type { Config } from "./config.js";
import { makeApiRouter } from "./routes/api.js";
import { makeDiffHandler } from "./routes/diff.js";
import { healthHandler } from "./routes/health.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const resolveWebDir = async (): Promise<string | null> => {
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

export type AppOptions = {
  config: Config;
  store: TokenStore;
  webDir?: string | null;
};

export const createApp = (opts: AppOptions): Express => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/healthz", healthHandler);
  app.post("/diff", makeDiffHandler(opts.config, opts.store));
  app.use("/api", makeApiRouter(opts.config, opts.store));

  if (opts.webDir) {
    app.use(express.static(opts.webDir));
    app.get(/^\/(?!api|diff|healthz).*/, (_req, res) => {
      res.sendFile(path.join(opts.webDir as string, "index.html"));
    });
  }

  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: "internal_error", message: err.message });
    },
  );

  return app;
};
