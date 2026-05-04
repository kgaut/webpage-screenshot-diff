import path from "node:path";

const intEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid integer for env ${name}: ${raw}`);
  }
  return parsed;
};

const stringEnv = (name: string, fallback: string): string => {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
};

export type Config = {
  port: number;
  dataDir: string;
  historySize: number;
  maxConcurrency: number;
  defaultViewport: { width: number; height: number };
  navigationTimeoutMs: number;
  logLevel: "debug" | "info" | "warn" | "error";
  adminToken: string | null;
};

export const loadConfig = (): Config => {
  const logLevel = stringEnv("LOG_LEVEL", "info");
  if (!["debug", "info", "warn", "error"].includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${logLevel}`);
  }
  const adminToken = process.env.ADMIN_TOKEN ?? "";
  return {
    port: intEnv("PORT", 3000),
    dataDir: path.resolve(stringEnv("DATA_DIR", "/data")),
    historySize: intEnv("HISTORY_SIZE", 10),
    maxConcurrency: Math.max(1, intEnv("MAX_CONCURRENCY", 4)),
    defaultViewport: {
      width: intEnv("DEFAULT_VIEWPORT_WIDTH", 1280),
      height: intEnv("DEFAULT_VIEWPORT_HEIGHT", 800),
    },
    navigationTimeoutMs: intEnv("NAVIGATION_TIMEOUT_MS", 30_000),
    logLevel: logLevel as Config["logLevel"],
    adminToken: adminToken.length > 0 ? adminToken : null,
  };
};
