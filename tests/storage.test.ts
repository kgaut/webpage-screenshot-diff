import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPaths,
  ensureLayout,
  newHistoryEntry,
  readBaseline,
  rotateHistory,
  updateIndex,
  writeBaseline,
  writeHistory,
} from "../src/storage.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "screenshot-diff-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("storage", () => {
  it("creates the expected directory layout", async () => {
    const paths = buildPaths(tmpDir);
    await ensureLayout(paths);
    const stats = await Promise.all([
      fs.stat(paths.baselineDir),
      fs.stat(paths.historyDir),
    ]);
    expect(stats.every((s) => s.isDirectory())).toBe(true);
  });

  it("returns null when reading a missing baseline", async () => {
    const paths = buildPaths(tmpDir);
    await ensureLayout(paths);
    const result = await readBaseline(paths, "deadbeef");
    expect(result).toBeNull();
  });

  it("writes and reads a baseline", async () => {
    const paths = buildPaths(tmpDir);
    await ensureLayout(paths);
    await writeBaseline(paths, "abc123", fakePng, { url: "https://x" });
    const read = await readBaseline(paths, "abc123");
    expect(read).not.toBeNull();
    expect(Buffer.compare(read!, fakePng)).toBe(0);
    const meta = JSON.parse(await fs.readFile(path.join(paths.baselineDir, "abc123.json"), "utf8"));
    expect(meta.url).toBe("https://x");
  });

  it("rotateHistory keeps only the N most recent captures", async () => {
    const paths = buildPaths(tmpDir);
    await ensureLayout(paths);
    const hash = "rotate";
    for (let i = 0; i < 5; i++) {
      const entry = newHistoryEntry(paths, hash);
      await writeHistory(entry, fakePng, fakePng, { i });
      // Avoid timestamp collision (timestamps include milliseconds)
      await new Promise((r) => setTimeout(r, 5));
    }
    await rotateHistory(paths, hash, 3);
    const remaining = (await fs.readdir(path.join(paths.historyDir, hash)))
      .filter((f) => f.endsWith(".png") && !f.endsWith(".diff.png"));
    expect(remaining.length).toBe(3);
  });

  it("rotateHistory is a noop on missing directory", async () => {
    const paths = buildPaths(tmpDir);
    await ensureLayout(paths);
    await expect(rotateHistory(paths, "missing", 3)).resolves.toBeUndefined();
  });

  it("updateIndex creates and updates the index file", async () => {
    const paths = buildPaths(tmpDir);
    await ensureLayout(paths);
    await updateIndex(paths, "h1", "https://a");
    await updateIndex(paths, "h2", "https://b");
    const idx = JSON.parse(await fs.readFile(paths.indexFile, "utf8"));
    expect(idx).toEqual({ h1: "https://a", h2: "https://b" });
  });
});
