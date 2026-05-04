import { promises as fs } from "node:fs";
import path from "node:path";

const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export const isValidProjectName = (name: string): boolean =>
  name.length > 0 && name.length <= 200 && PROJECT_RE.test(name) && !name.includes("..");

export type ProjectPaths = {
  dataDir: string;
  projectsRoot: string;
  project: string;
  projectDir: string;
  baselineDir: string;
  historyDir: string;
  indexFile: string;
};

const PROJECTS_INDEX = "projects.json";

export const projectsRoot = (dataDir: string): string => path.join(dataDir, "projects");

export const projectsIndexPath = (dataDir: string): string => path.join(dataDir, PROJECTS_INDEX);

export const buildProjectPaths = (dataDir: string, project: string): ProjectPaths => {
  if (!isValidProjectName(project)) {
    throw new Error(`Invalid project name: ${project}`);
  }
  const root = projectsRoot(dataDir);
  const projectDir = path.join(root, project);
  return {
    dataDir,
    projectsRoot: root,
    project,
    projectDir,
    baselineDir: path.join(projectDir, "baselines"),
    historyDir: path.join(projectDir, "history"),
    indexFile: path.join(projectDir, "index.json"),
  };
};

export const ensureLayout = async (paths: ProjectPaths): Promise<void> => {
  await fs.mkdir(paths.baselineDir, { recursive: true });
  await fs.mkdir(paths.historyDir, { recursive: true });
};

export const ensureRoot = async (dataDir: string): Promise<void> => {
  await fs.mkdir(projectsRoot(dataDir), { recursive: true });
};

const writeAtomic = async (filePath: string, data: Buffer | string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, filePath);
};

export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const readBaseline = async (paths: ProjectPaths, hash: string): Promise<Buffer | null> => {
  const filePath = path.join(paths.baselineDir, `${hash}.png`);
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
};

export const writeBaseline = async (
  paths: ProjectPaths,
  hash: string,
  png: Buffer,
  meta: object,
): Promise<void> => {
  await writeAtomic(path.join(paths.baselineDir, `${hash}.png`), png);
  await writeAtomic(path.join(paths.baselineDir, `${hash}.json`), JSON.stringify(meta, null, 2));
};

export type HistoryEntry = {
  pngPath: string;
  diffPath: string;
  metaPath: string;
  timestamp: string;
};

const isoCompactNow = (): string => new Date().toISOString().replace(/[:.]/g, "-");

export const newHistoryEntry = (paths: ProjectPaths, hash: string): HistoryEntry => {
  const timestamp = isoCompactNow();
  const dir = path.join(paths.historyDir, hash);
  return {
    timestamp,
    pngPath: path.join(dir, `${timestamp}.png`),
    diffPath: path.join(dir, `${timestamp}.diff.png`),
    metaPath: path.join(dir, `${timestamp}.json`),
  };
};

export const writeHistory = async (
  entry: HistoryEntry,
  png: Buffer,
  diffPng: Buffer | null,
  meta: object,
): Promise<void> => {
  await writeAtomic(entry.pngPath, png);
  if (diffPng) await writeAtomic(entry.diffPath, diffPng);
  await writeAtomic(entry.metaPath, JSON.stringify(meta, null, 2));
};

export const rotateHistory = async (
  paths: ProjectPaths,
  hash: string,
  historySize: number,
): Promise<void> => {
  if (historySize <= 0) return;
  const dir = path.join(paths.historyDir, hash);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const captures = entries
    .filter((f) => f.endsWith(".png") && !f.endsWith(".diff.png"))
    .map((f) => f.replace(/\.png$/, ""))
    .sort()
    .reverse();
  const toDelete = captures.slice(historySize);
  await Promise.all(
    toDelete.flatMap((ts) => [
      fs.rm(path.join(dir, `${ts}.png`), { force: true }),
      fs.rm(path.join(dir, `${ts}.diff.png`), { force: true }),
      fs.rm(path.join(dir, `${ts}.json`), { force: true }),
      // Also drop cached thumbnails for that timestamp.
      fs.rm(path.join(dir, `${ts}.thumb.png`), { force: true }),
      fs.rm(path.join(dir, `${ts}.diff.thumb.png`), { force: true }),
    ]),
  );
};

export const updateIndex = async (
  paths: ProjectPaths,
  hash: string,
  url: string,
): Promise<void> => {
  let index: Record<string, string> = {};
  try {
    const raw = await fs.readFile(paths.indexFile, "utf8");
    index = JSON.parse(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (index[hash] === url) return;
  index[hash] = url;
  await writeAtomic(paths.indexFile, JSON.stringify(index, null, 2));
};

type ProjectsIndex = Record<string, { firstSeenAt: string; lastSeenAt: string }>;

export const recordProjectActivity = async (
  dataDir: string,
  project: string,
  at: string,
): Promise<void> => {
  const file = projectsIndexPath(dataDir);
  let idx: ProjectsIndex = {};
  try {
    idx = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const existing = idx[project];
  idx[project] = { firstSeenAt: existing?.firstSeenAt ?? at, lastSeenAt: at };
  await writeAtomic(file, JSON.stringify(idx, null, 2));
};

export type ProjectSummary = {
  name: string;
  firstSeenAt: string;
  lastSeenAt: string;
  pageCount: number;
};

export const listProjects = async (dataDir: string): Promise<ProjectSummary[]> => {
  let idx: ProjectsIndex = {};
  try {
    idx = JSON.parse(await fs.readFile(projectsIndexPath(dataDir), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return [];
  }
  const projects = Object.keys(idx).sort();
  return Promise.all(
    projects.map(async (name) => {
      let pageCount = 0;
      try {
        const paths = buildProjectPaths(dataDir, name);
        const baselines = await fs.readdir(paths.baselineDir);
        pageCount = baselines.filter((f) => f.endsWith(".png")).length;
      } catch {
        // ignore
      }
      return {
        name,
        firstSeenAt: idx[name].firstSeenAt,
        lastSeenAt: idx[name].lastSeenAt,
        pageCount,
      };
    }),
  );
};

export type PageSummary = {
  hash: string;
  url: string;
  lastCapturedAt: string | null;
  lastDiffRatio: number | null;
  lastOk: boolean | null;
  captureCount: number;
};

export const listPages = async (paths: ProjectPaths): Promise<PageSummary[]> => {
  let urlIndex: Record<string, string> = {};
  try {
    urlIndex = JSON.parse(await fs.readFile(paths.indexFile, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return [];
  }
  const hashes = Object.keys(urlIndex).sort();
  return Promise.all(
    hashes.map(async (hash) => {
      const dir = path.join(paths.historyDir, hash);
      let captureCount = 0;
      let lastCapturedAt: string | null = null;
      let lastDiffRatio: number | null = null;
      let lastOk: boolean | null = null;
      try {
        const files = await fs.readdir(dir);
        const captures = files
          .filter(
            (f) => f.endsWith(".png") && !f.endsWith(".diff.png") && !f.endsWith(".thumb.png"),
          )
          .map((f) => f.replace(/\.png$/, ""))
          .sort();
        captureCount = captures.length;
        const last = captures[captures.length - 1];
        if (last) {
          try {
            const meta = JSON.parse(await fs.readFile(path.join(dir, `${last}.json`), "utf8"));
            lastCapturedAt = meta.capturedAt ?? null;
            lastDiffRatio = typeof meta.diffRatio === "number" ? meta.diffRatio : null;
            lastOk = typeof meta.ok === "boolean" ? meta.ok : null;
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
      return {
        hash,
        url: urlIndex[hash],
        lastCapturedAt,
        lastDiffRatio,
        lastOk,
        captureCount,
      };
    }),
  );
};

export type HistoryEntrySummary = {
  timestamp: string;
  capturedAt: string | null;
  diffRatio: number | null;
  threshold: number | null;
  ok: boolean | null;
  created: boolean;
  hasDiffImage: boolean;
};

export const listHistory = async (
  paths: ProjectPaths,
  hash: string,
): Promise<HistoryEntrySummary[]> => {
  const dir = path.join(paths.historyDir, hash);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const timestamps = files
    .filter((f) => f.endsWith(".png") && !f.endsWith(".diff.png") && !f.endsWith(".thumb.png"))
    .map((f) => f.replace(/\.png$/, ""))
    .sort()
    .reverse();
  return Promise.all(
    timestamps.map(async (ts) => {
      let meta: Partial<HistoryEntrySummary> & {
        capturedAt?: string;
        diffRatio?: number;
        threshold?: number;
        ok?: boolean;
        created?: boolean;
      } = {};
      try {
        meta = JSON.parse(await fs.readFile(path.join(dir, `${ts}.json`), "utf8"));
      } catch {
        // ignore
      }
      const hasDiffImage = await fileExists(path.join(dir, `${ts}.diff.png`));
      return {
        timestamp: ts,
        capturedAt: meta.capturedAt ?? null,
        diffRatio: typeof meta.diffRatio === "number" ? meta.diffRatio : null,
        threshold: typeof meta.threshold === "number" ? meta.threshold : null,
        ok: typeof meta.ok === "boolean" ? meta.ok : null,
        created: meta.created === true,
        hasDiffImage,
      };
    }),
  );
};
