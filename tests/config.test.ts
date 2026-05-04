import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const ENV_KEYS = [
  "PORT",
  "DATA_DIR",
  "HISTORY_SIZE",
  "MAX_CONCURRENCY",
  "DEFAULT_VIEWPORT_WIDTH",
  "DEFAULT_VIEWPORT_HEIGHT",
  "NAVIGATION_TIMEOUT_MS",
  "LOG_LEVEL",
  "ADMIN_TOKEN",
];

let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  snapshot = {};
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
});

describe("loadConfig", () => {
  it("returns sane defaults when no env is set", () => {
    const cfg = loadConfig();
    expect(cfg.port).toBe(3000);
    expect(cfg.historySize).toBe(10);
    expect(cfg.maxConcurrency).toBe(4);
    expect(cfg.defaultViewport).toEqual({ width: 1280, height: 800 });
    expect(cfg.navigationTimeoutMs).toBe(30_000);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.adminToken).toBeNull();
  });

  it("reads ADMIN_TOKEN from the environment", () => {
    process.env.ADMIN_TOKEN = "supersecret";
    const cfg = loadConfig();
    expect(cfg.adminToken).toBe("supersecret");
  });

  it("treats an empty ADMIN_TOKEN as unset", () => {
    process.env.ADMIN_TOKEN = "";
    expect(loadConfig().adminToken).toBeNull();
  });

  it("parses integer env vars", () => {
    process.env.PORT = "8080";
    process.env.HISTORY_SIZE = "25";
    process.env.MAX_CONCURRENCY = "8";
    const cfg = loadConfig();
    expect(cfg.port).toBe(8080);
    expect(cfg.historySize).toBe(25);
    expect(cfg.maxConcurrency).toBe(8);
  });

  it("forces MAX_CONCURRENCY to be at least 1", () => {
    process.env.MAX_CONCURRENCY = "0";
    expect(loadConfig().maxConcurrency).toBe(1);
  });

  it("rejects non-integer env values", () => {
    process.env.PORT = "abc";
    expect(() => loadConfig()).toThrow(/Invalid integer/);
  });

  it("rejects unknown LOG_LEVEL values", () => {
    process.env.LOG_LEVEL = "verbose";
    expect(() => loadConfig()).toThrow(/Invalid LOG_LEVEL/);
  });
});
