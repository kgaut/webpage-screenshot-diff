import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/capture.js", () => ({
  captureUrl: vi.fn(async () => makeFixedPng()),
  closeBrowser: vi.fn(),
}));

import { createApp } from "../src/app.js";
import { __resetSerialisation, createTokenStore } from "../src/auth.js";
import type { Config } from "../src/config.js";

const makeFixedPng = (): Buffer => {
  const png = new PNG({ width: 10, height: 10 });
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const idx = (10 * y + x) << 2;
      png.data[idx] = 200;
      png.data[idx + 1] = 100;
      png.data[idx + 2] = 50;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
};

let tmpDir: string;

const buildApp = (overrides: Partial<Config> = {}) => {
  const config: Config = {
    port: 0,
    dataDir: tmpDir,
    historySize: 5,
    maxConcurrency: 2,
    defaultViewport: { width: 320, height: 200 },
    navigationTimeoutMs: 5000,
    logLevel: "warn",
    adminToken: null,
    ...overrides,
  };
  const store = createTokenStore(tmpDir);
  return { app: createApp({ config, store }), store, config };
};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "diff-route-"));
  __resetSerialisation();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("POST /diff", () => {
  it("creates a new project and returns a one-time token", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/diff")
      .send({ project: "acme/site", urls: ["https://example.com/"] })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.project).toBe("acme/site");
    expect(typeof res.body.token).toBe("string");
    expect(res.body.results[0].created).toBe(true);

    const tokensFile = path.join(tmpDir, "tokens.json");
    const persisted = JSON.parse(await fs.readFile(tokensFile, "utf8"));
    expect(persisted["acme/site"]).toBeDefined();
    expect(persisted["acme/site"].tokenHash).not.toBe(res.body.token);
  });

  it("rejects a second call without token (existing project)", async () => {
    const { app } = buildApp();
    await request(app)
      .post("/diff")
      .send({ project: "acme", urls: ["https://example.com/"] })
      .expect(200);

    const res = await request(app)
      .post("/diff")
      .send({ project: "acme", urls: ["https://example.com/"] })
      .expect(401);
    expect(res.body.error).toBe("missing_token");
  });

  it("rejects a wrong token with 403", async () => {
    const { app } = buildApp();
    await request(app)
      .post("/diff")
      .send({ project: "acme", urls: ["https://example.com/"] });

    const res = await request(app)
      .post("/diff")
      .send({ project: "acme", urls: ["https://example.com/"], token: "wrong" })
      .expect(403);
    expect(res.body.error).toBe("invalid_token");
  });

  it("accepts the project token and updates the baseline", async () => {
    const { app } = buildApp();
    const first = await request(app)
      .post("/diff")
      .send({ project: "acme", urls: ["https://example.com/"] });
    const token = first.body.token as string;

    const second = await request(app)
      .post("/diff")
      .send({ project: "acme", urls: ["https://example.com/"], token })
      .expect(200);
    expect(second.body.results[0].diffRatio).toBe(0);
    expect(second.body.results[0].created).toBe(false);
    expect(second.body.token).toBeUndefined();
  });

  it("accepts the admin token via Authorization header", async () => {
    const { app } = buildApp({ adminToken: "admin-secret" });
    await request(app)
      .post("/diff")
      .send({ project: "acme", urls: ["https://example.com/"] });

    await request(app)
      .post("/diff")
      .set("Authorization", "Bearer admin-secret")
      .send({ project: "acme", urls: ["https://example.com/"] })
      .expect(200);
  });

  it("rejects an invalid project name with 400", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/diff")
      .send({ project: "../escape", urls: ["https://example.com/"] })
      .expect(400);
    expect(res.body.error).toBe("invalid_request");
  });
});

describe("GET /api/projects auth", () => {
  it("returns 401 without token", async () => {
    const { app } = buildApp();
    await request(app).get("/api/projects").expect(401);
  });

  it("returns all projects to the admin", async () => {
    const { app } = buildApp({ adminToken: "admin" });
    await request(app)
      .post("/diff")
      .send({ project: "p1", urls: ["https://example.com/a"] });
    await request(app)
      .post("/diff")
      .send({ project: "p2", urls: ["https://example.com/b"] });

    const res = await request(app).get("/api/projects?token=admin").expect(200);
    expect(res.body.projects.map((p: { name: string }) => p.name).sort()).toEqual(["p1", "p2"]);
  });

  it("filters to a single project for a project-scoped token", async () => {
    const { app } = buildApp();
    const r1 = await request(app)
      .post("/diff")
      .send({ project: "p1", urls: ["https://example.com/a"] });
    await request(app)
      .post("/diff")
      .send({ project: "p2", urls: ["https://example.com/b"] });

    const res = await request(app)
      .get(`/api/projects?token=${encodeURIComponent(r1.body.token)}`)
      .expect(200);
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.projects[0].name).toBe("p1");
  });
});
