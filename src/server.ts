import { createApp, resolveWebDir } from "./app.js";
import { createTokenStore } from "./auth.js";
import { closeBrowser } from "./capture.js";
import { loadConfig } from "./config.js";
import { ensureRoot } from "./storage.js";

const log = (level: string, msg: string, extra?: object): void => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  process.stdout.write(`${line}\n`);
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  await ensureRoot(config.dataDir);
  const tokenStore = createTokenStore(config.dataDir);
  const webDir = await resolveWebDir();

  if (!config.adminToken) {
    log("warn", "admin_token_unset", {
      hint: "set ADMIN_TOKEN to grant cross-project access from the dashboard",
    });
  }

  const app = createApp({ config, store: tokenStore, webDir });
  if (webDir) log("info", "web_ui_enabled", { webDir });
  else log("warn", "web_ui_missing", { hint: "build the SPA in web/dist or set WEB_DIST_DIR" });

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
