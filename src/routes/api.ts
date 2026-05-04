import { promises as fs } from "node:fs";
import path from "node:path";
import { type NextFunction, type Request, type Response, Router } from "express";
import sharp from "sharp";
import type { TokenStore } from "../auth.js";
import type { Config } from "../config.js";
import { type AuthOptions, authoriseProject, requireAnyAuth } from "../middleware/auth.js";
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
  if (candidate !== normalizedRoot && !candidate.startsWith(normalizedRoot + path.sep)) {
    return null;
  }
  return candidate;
};

export const makeApiRouter = (config: Config, store: TokenStore): Router => {
  const router = Router();
  const root = projectsRoot(config.dataDir);
  const authOpts: AuthOptions = { adminToken: config.adminToken, store };

  // Helper that gates a handler behind a per-project token check derived from
  // the route param. Using express middleware composition here rather than a
  // generic chain keeps the project lookup explicit at each call site.
  const projectGuard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const project = decodeProject(req.params.project);
    if (!project) {
      res.status(400).json({ error: "invalid_project" });
      return;
    }
    const denial = await authoriseProject(authOpts, req, project);
    if (denial) {
      res.status(denial.status).json({ error: denial.error });
      return;
    }
    (req as Request & { resolvedProject: string }).resolvedProject = project;
    next();
  };

  router.get("/projects", requireAnyAuth(authOpts), async (req, res, next) => {
    try {
      const all = await listProjects(config.dataDir);
      const auth = req.auth;
      const projects = auth?.admin
        ? all
        : all.filter((p) => p.name === (auth?.admin === false ? auth.project : ""));
      res.json({ projects });
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:project/pages", projectGuard, async (req, res, next) => {
    try {
      const project = (req as Request & { resolvedProject: string }).resolvedProject;
      const paths = buildProjectPaths(config.dataDir, project);
      res.json({ project, pages: await listPages(paths) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:project/pages/:hash/history", projectGuard, async (req, res, next) => {
    const { hash } = req.params;
    if (!HASH_RE.test(hash)) {
      res.status(400).json({ error: "invalid_hash" });
      return;
    }
    try {
      const project = (req as Request & { resolvedProject: string }).resolvedProject;
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
  router.get("/file", async (req, res, next) => {
    try {
      const handled = await guardFileRequest(authOpts, req, res);
      if (!handled.ok) return;
      const file = resolveFile(config.dataDir, handled.project, req);
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
      const handled = await guardFileRequest(authOpts, req, res);
      if (!handled.ok) return;
      const file = resolveFile(config.dataDir, handled.project, req);
      if (file === "invalid") {
        res.status(400).json({ error: "invalid_request" });
        return;
      }
      const width = Math.min(
        800,
        Math.max(40, Number.parseInt(String(req.query.w ?? "240"), 10) || 240),
      );
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

  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal_error", message: err.message });
  });

  return router;
};

const guardFileRequest = async (
  authOpts: AuthOptions,
  req: Request,
  res: Response,
): Promise<{ ok: false } | { ok: true; project: string }> => {
  const project = decodeProject(String(req.query.project ?? ""));
  if (!project) {
    res.status(400).json({ error: "invalid_project" });
    return { ok: false };
  }
  const denial = await authoriseProject(authOpts, req, project);
  if (denial) {
    res.status(denial.status).json({ error: denial.error });
    return { ok: false };
  }
  return { ok: true, project };
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

const resolveFile = (dataDir: string, project: string, req: Request): string | "invalid" => {
  const kind = String(req.query.kind ?? "") as Kind;
  const hash = String(req.query.hash ?? "");
  const ts = String(req.query.ts ?? "");
  if (!HASH_RE.test(hash)) return "invalid";
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
  const safe = safeJoinUnderRoot(
    projectsRoot(dataDir),
    path.relative(projectsRoot(dataDir), candidate),
  );
  return safe ?? "invalid";
};
