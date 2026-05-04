import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTokenStore } from "../src/auth.js";
import {
  type AuthOptions,
  authoriseProject,
  extractToken,
  isAdminToken,
} from "../src/middleware/auth.js";

type FakeReq = {
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  auth?: unknown;
};

const req = (init: Partial<FakeReq>): FakeReq => ({
  query: {},
  headers: {},
  body: {},
  ...init,
});

describe("extractToken", () => {
  it("reads from the query string first", () => {
    const r = req({
      query: { token: "from-query" },
      headers: { authorization: "Bearer from-header" },
      body: { token: "from-body" },
    });
    expect(extractToken(r as never)).toBe("from-query");
  });

  it("reads from the Authorization header (Bearer scheme)", () => {
    expect(extractToken(req({ headers: { authorization: "Bearer abc.def" } }) as never)).toBe(
      "abc.def",
    );
    expect(extractToken(req({ headers: { authorization: "bearer abc.def" } }) as never)).toBe(
      "abc.def",
    );
  });

  it("falls back to the request body", () => {
    expect(extractToken(req({ body: { token: "from-body" } }) as never)).toBe("from-body");
  });

  it("returns null when nothing is present", () => {
    expect(extractToken(req({}) as never)).toBeNull();
  });
});

describe("isAdminToken", () => {
  it("matches only when both tokens are non-empty and equal", () => {
    expect(isAdminToken({ adminToken: "secret" } as AuthOptions, "secret")).toBe(true);
    expect(isAdminToken({ adminToken: "secret" } as AuthOptions, "other")).toBe(false);
    expect(isAdminToken({ adminToken: null } as AuthOptions, "secret")).toBe(false);
    expect(isAdminToken({ adminToken: "secret" } as AuthOptions, null)).toBe(false);
  });
});

describe("authoriseProject", () => {
  it("denies with missing_token when no credential is provided", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "auth-mw-"));
    try {
      const opts: AuthOptions = { adminToken: null, store: createTokenStore(tmp) };
      const r = req({});
      const denial = await authoriseProject(opts, r as never, "acme");
      expect(denial).toEqual({ status: 401, error: "missing_token" });
      expect(r.auth).toBeUndefined();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("denies with invalid_token when the token doesn't match", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "auth-mw-"));
    try {
      const store = createTokenStore(tmp);
      await store.ensure("acme");
      const opts: AuthOptions = { adminToken: null, store };
      const r = req({ query: { token: "wrong" } });
      const denial = await authoriseProject(opts, r as never, "acme");
      expect(denial).toEqual({ status: 403, error: "invalid_token" });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("grants admin access when ADMIN_TOKEN matches", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "auth-mw-"));
    try {
      const store = createTokenStore(tmp);
      const opts: AuthOptions = { adminToken: "admin", store };
      const r = req({ headers: { authorization: "Bearer admin" } });
      const denial = await authoriseProject(opts, r as never, "acme");
      expect(denial).toBeNull();
      expect(r.auth).toEqual({ admin: true });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("grants project-scoped access when the project token matches", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "auth-mw-"));
    try {
      const store = createTokenStore(tmp);
      const ensured = await store.ensure("acme");
      if (!ensured.created) throw new Error("expected creation");
      const opts: AuthOptions = { adminToken: null, store };
      const r = req({ query: { token: ensured.token } });
      const denial = await authoriseProject(opts, r as never, "acme");
      expect(denial).toBeNull();
      expect(r.auth).toEqual({ admin: false, project: "acme" });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
