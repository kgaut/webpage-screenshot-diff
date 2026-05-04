import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildProjectPaths,
  ensureLayout,
  ensureRoot,
  isValidProjectName,
  listPages,
  listProjects,
  newHistoryEntry,
  readBaseline,
  recordProjectActivity,
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

describe("project name validation", () => {
  it("accepts simple and namespaced names", () => {
    expect(isValidProjectName("acme")).toBe(true);
    expect(isValidProjectName("acme/website")).toBe(true);
    expect(isValidProjectName("acme/group/repo")).toBe(true);
    expect(isValidProjectName("a.b-c_d.0")).toBe(true);
  });

  it("rejects unsafe or empty names", () => {
    expect(isValidProjectName("")).toBe(false);
    expect(isValidProjectName("/leading")).toBe(false);
    expect(isValidProjectName("trailing/")).toBe(false);
    expect(isValidProjectName("../escape")).toBe(false);
    expect(isValidProjectName("a b")).toBe(false);
    expect(isValidProjectName("double//slash")).toBe(false);
  });
});

describe("storage", () => {
  it("creates the expected directory layout under projects/<name>", async () => {
    await ensureRoot(tmpDir);
    const paths = buildProjectPaths(tmpDir, "acme/website");
    await ensureLayout(paths);
    const stats = await Promise.all([fs.stat(paths.baselineDir), fs.stat(paths.historyDir)]);
    expect(stats.every((s) => s.isDirectory())).toBe(true);
    expect(paths.projectDir).toContain(path.join("projects", "acme", "website"));
  });

  it("returns null when reading a missing baseline", async () => {
    const paths = buildProjectPaths(tmpDir, "acme");
    await ensureLayout(paths);
    const result = await readBaseline(paths, "deadbeef");
    expect(result).toBeNull();
  });

  it("writes and reads a baseline", async () => {
    const paths = buildProjectPaths(tmpDir, "acme");
    await ensureLayout(paths);
    await writeBaseline(paths, "abc123", fakePng, { url: "https://x" });
    const read = await readBaseline(paths, "abc123");
    expect(read).not.toBeNull();
    expect(Buffer.compare(read!, fakePng)).toBe(0);
    const meta = JSON.parse(await fs.readFile(path.join(paths.baselineDir, "abc123.json"), "utf8"));
    expect(meta.url).toBe("https://x");
  });

  it("rotateHistory keeps only the N most recent captures", async () => {
    const paths = buildProjectPaths(tmpDir, "acme");
    await ensureLayout(paths);
    const hash = "rotate";
    for (let i = 0; i < 5; i++) {
      const entry = newHistoryEntry(paths, hash);
      await writeHistory(entry, fakePng, fakePng, { i });
      await new Promise((r) => setTimeout(r, 5));
    }
    await rotateHistory(paths, hash, 3);
    const remaining = (await fs.readdir(path.join(paths.historyDir, hash))).filter(
      (f) => f.endsWith(".png") && !f.endsWith(".diff.png"),
    );
    expect(remaining.length).toBe(3);
  });

  it("rotateHistory is a noop on missing directory", async () => {
    const paths = buildProjectPaths(tmpDir, "acme");
    await ensureLayout(paths);
    await expect(rotateHistory(paths, "missing", 3)).resolves.toBeUndefined();
  });

  it("updateIndex creates and updates the index file per project", async () => {
    const paths = buildProjectPaths(tmpDir, "acme/site");
    await ensureLayout(paths);
    await updateIndex(paths, "h1", "https://a");
    await updateIndex(paths, "h2", "https://b");
    const idx = JSON.parse(await fs.readFile(paths.indexFile, "utf8"));
    expect(idx).toEqual({ h1: "https://a", h2: "https://b" });
  });

  it("recordProjectActivity + listProjects expose active projects", async () => {
    await ensureRoot(tmpDir);
    const paths = buildProjectPaths(tmpDir, "acme/site");
    await ensureLayout(paths);
    await writeBaseline(paths, "h1", fakePng, { url: "https://a" });
    await updateIndex(paths, "h1", "https://a");
    await recordProjectActivity(tmpDir, "acme/site", "2026-01-01T00:00:00Z");
    const projects = await listProjects(tmpDir);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("acme/site");
    expect(projects[0].pageCount).toBe(1);
  });

  it("listPages exposes captured pages with last-run metadata", async () => {
    const paths = buildProjectPaths(tmpDir, "acme");
    await ensureLayout(paths);
    await updateIndex(paths, "h1", "https://x.example/");
    const entry = newHistoryEntry(paths, "h1");
    await writeHistory(entry, fakePng, null, {
      url: "https://x.example/",
      capturedAt: "2026-01-01T00:00:00Z",
      diffRatio: 0,
      threshold: 0.1,
      ok: true,
      created: true,
    });
    const pages = await listPages(paths);
    expect(pages).toHaveLength(1);
    expect(pages[0].url).toBe("https://x.example/");
    expect(pages[0].lastOk).toBe(true);
    expect(pages[0].captureCount).toBe(1);
  });
});
