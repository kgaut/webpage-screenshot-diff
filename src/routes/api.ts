import { promises as fs } from "node:fs";
import path from "node:path";
import { Router, type Request, type Response, type NextFunction } from "express";
import sharp from "sharp";
import type { Config } from "../config.js";
import {
  buildProjectPaths,
  fileExists,
  isValidProjectName,
  listHistory,
  listPages,
  listProjects,
  projectsRoot,
} from "../storage.js";

const decodeProject = (raw: string): string | null => {
  try {
    const decoded = decodeURIComponent(raw);
    return isValidProjectName(decoded) ? decoded : null;
  } catch {
    return null;
  }
};

const HASH_RE = /^[a-f0-9]{64}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

const safeJoinUnderRoot = (root: string, ...segments: string[]): string | null => {
  const candidate = path.resolve(root, ...segments);
  const normalizedRoot = path.resolve(root);
  if (
    candidate !== normalizedRoot &&
    !candidate.startsWith(normalizedRoot + path.sep)
  ) {
    return null;
  }
  return candidate;
};

export const makeApiRouter = (config: Config): Router => {
  const router = Router();
  const root = projectsRoot(config.dataDir);

  router.get("/projects", async (_req, res, next) => {
    try {
      res.json({ projects: await listProjects(config.dataDir) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:project/pages", async (req, res, next) => {
    const project = decodeProject(req.params.project);
    if (!project) {
      res.status(400).json({ error: "invalid_project" });
      return;
    }
    try {
      const paths = buildProjectPaths(config.dataDir, project);
      res.json({ project, pages: await listPages(paths) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:project/pages/:hash/history", async (req, res, next) => {
    const project = decodeProject(req.params.project);
    const { hash } = req.params;
    if (!project) {
      res.status(400).json({ error: "invalid_project" });
      return;
    }
    if (!HASH_RE.test(hash)) {
      res.status(400).json({ error: "invalid_hash" });
      return;
    }
    try {
      const paths = buildProjectPaths(config.dataDir, project);
      const url = await readUrlFromIndex(paths.indexFile, hash);
      const entries = await listHistory(paths, hash);
      res.json({ project, hash, url, entries });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/file?project=foo&kind=screenshot&hash=...&ts=...
  // GET /api/file?project=foo&kind=baseline&hash=...
  // GET /api/thumb?... (same parameters + ?w=200)
  router.get("/file", async (req, res, next) => {
    try {
      const file = resolveFile(config.dataDir, req);
      if (file === "invalid") {
        res.status(400).json({ error: "invalid_request" });
        return;
      }
      if (!(await fileExists(file))) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.type("image/png").sendFile(file);
    } catch (err) {
      next(err);
    }
  });

  router.get("/thumb", async (req, res, next) => {
    try {
      const file = resolveFile(config.dataDir, req);
      if (file === "invalid") {
        res.status(400).json({ error: "invalid_request" });
        return;
      }
      const width = Math.min(800, Math.max(40, Number.parseInt(String(req.query.w ?? "240"), 10) || 240));
      if (!(await fileExists(file))) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const thumbPath = `${file.replace(/\.png$/, "")}.thumb-${width}.png`;
      const safeThumb = safeJoinUnderRoot(root, path.relative(root, thumbPath));
      if (!safeThumb) {
        res.status(400).json({ error: "invalid_request" });
        return;
      }
      if (!(await fileExists(safeThumb))) {
        await sharp(file).resize({ width, withoutEnlargement: true }).png().toFile(safeThumb);
      }
      res.type("image/png").sendFile(safeThumb);
    } catch (err) {
      next(err);
    }
  });

  // Centralised error handler scoped to this router.
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal_error", message: err.message });
  });

  return router;
};

const readUrlFromIndex = async (indexFile: string, hash: string): Promise<string | null> => {
  try {
    const idx = JSON.parse(await fs.readFile(indexFile, "utf8")) as Record<string, string>;
    return idx[hash] ?? null;
  } catch {
    return null;
  }
};

type Kind = "screenshot" | "baseline" | "diff";

const resolveFile = (dataDir: string, req: Request): string | "invalid" => {
  const project = decodeProject(String(req.query.project ?? ""));
  const kind = String(req.query.kind ?? "") as Kind;
  const hash = String(req.query.hash ?? "");
  const ts = String(req.query.ts ?? "");
  if (!project || !HASH_RE.test(hash)) return "invalid";
  if (kind !== "baseline" && !TS_RE.test(ts)) return "invalid";
  const paths = buildProjectPaths(dataDir, project);
  let candidate: string;
  if (kind === "baseline") {
    candidate = path.join(paths.baselineDir, `${hash}.png`);
  } else if (kind === "screenshot") {
    candidate = path.join(paths.historyDir, hash, `${ts}.png`);
  } else if (kind === "diff") {
    candidate = path.join(paths.historyDir, hash, `${ts}.diff.png`);
  } else {
    return "invalid";
  }
  const safe = safeJoinUnderRoot(projectsRoot(dataDir), path.relative(projectsRoot(dataDir), candidate));
  return safe ?? "invalid";
};
