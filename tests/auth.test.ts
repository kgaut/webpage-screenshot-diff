import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetSerialisation,
  createTokenStore,
  generateToken,
  hashToken,
  safeEqualHex,
  safeEqualString,
  tokensFilePath,
} from "../src/auth.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "screenshot-diff-auth-"));
  __resetSerialisation();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("token primitives", () => {
  it("generateToken yields a long random base64url string", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it("hashToken produces a deterministic 64-char digest", () => {
    expect(hashToken("hello")).toBe(hashToken("hello"));
    expect(hashToken("hello")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken("hello")).not.toBe(hashToken("world"));
  });

  it("safeEqualHex returns true for equal hex strings and false otherwise", () => {
    const h = hashToken("abc");
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, hashToken("def"))).toBe(false);
    expect(safeEqualHex(h, "")).toBe(false);
  });

  it("safeEqualString rejects strings of different lengths", () => {
    expect(safeEqualString("abcd", "abcd")).toBe(true);
    expect(safeEqualString("abcd", "abcde")).toBe(false);
    expect(safeEqualString("abcd", "abce")).toBe(false);
  });
});

describe("createTokenStore", () => {
  it("creates a token on first ensure() and persists only the hash", async () => {
    const store = createTokenStore(tmpDir);
    const result = await store.ensure("acme/website");
    expect(result.created).toBe(true);
    if (!result.created) return;
    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);

    const onDisk = JSON.parse(await fs.readFile(tokensFilePath(tmpDir), "utf8"));
    expect(onDisk["acme/website"].tokenHash).toBe(hashToken(result.token));
    expect(onDisk["acme/website"].tokenHash).not.toBe(result.token);
    expect(onDisk["acme/website"].createdAt).toMatch(/Z$/);
  });

  it("ensure() is idempotent for an existing project", async () => {
    const store = createTokenStore(tmpDir);
    const first = await store.ensure("acme");
    expect(first.created).toBe(true);
    const second = await store.ensure("acme");
    expect(second.created).toBe(false);
    expect(second.token).toBeNull();
  });

  it("ensure() serialises concurrent calls for a brand new project", async () => {
    const store = createTokenStore(tmpDir);
    const [a, b, c] = await Promise.all([store.ensure("p"), store.ensure("p"), store.ensure("p")]);
    const created = [a, b, c].filter((r) => r.created);
    expect(created).toHaveLength(1);
  });

  it("verify() returns true only for the exact token", async () => {
    const store = createTokenStore(tmpDir);
    const result = await store.ensure("acme");
    if (!result.created) throw new Error("expected creation");
    expect(await store.verify("acme", result.token)).toBe(true);
    expect(await store.verify("acme", `${result.token}x`)).toBe(false);
    expect(await store.verify("missing", result.token)).toBe(false);
    expect(await store.verify("acme", "")).toBe(false);
  });

  it("has() reflects the persisted state", async () => {
    const store = createTokenStore(tmpDir);
    expect(await store.has("acme")).toBe(false);
    await store.ensure("acme");
    expect(await store.has("acme")).toBe(true);
  });

  it("list() returns project names sorted", async () => {
    const store = createTokenStore(tmpDir);
    await store.ensure("b");
    await store.ensure("a");
    await store.ensure("c");
    expect(await store.list()).toEqual(["a", "b", "c"]);
  });

  it("survives a restart by re-reading the file", async () => {
    const first = createTokenStore(tmpDir);
    const r = await first.ensure("acme");
    if (!r.created) throw new Error("expected creation");

    const reopened = createTokenStore(tmpDir);
    expect(await reopened.has("acme")).toBe(true);
    expect(await reopened.verify("acme", r.token)).toBe(true);
  });
});
