import { promises as fs } from "node:fs";
import path from "node:path";

export type StoragePaths = {
  dataDir: string;
  baselineDir: string;
  historyDir: string;
  indexFile: string;
};

export const buildPaths = (dataDir: string): StoragePaths => ({
  dataDir,
  baselineDir: path.join(dataDir, "baselines"),
  historyDir: path.join(dataDir, "history"),
  indexFile: path.join(dataDir, "index.json"),
});

export const ensureLayout = async (paths: StoragePaths): Promise<void> => {
  await fs.mkdir(paths.baselineDir, { recursive: true });
  await fs.mkdir(paths.historyDir, { recursive: true });
};

const writeAtomic = async (filePath: string, data: Buffer | string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
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

export const readBaseline = async (
  paths: StoragePaths,
  hash: string,
): Promise<Buffer | null> => {
  const filePath = path.join(paths.baselineDir, `${hash}.png`);
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
};

export const writeBaseline = async (
  paths: StoragePaths,
  hash: string,
  png: Buffer,
  meta: object,
): Promise<void> => {
  await writeAtomic(path.join(paths.baselineDir, `${hash}.png`), png);
  await writeAtomic(
    path.join(paths.baselineDir, `${hash}.json`),
    JSON.stringify(meta, null, 2),
  );
};

export type HistoryEntry = {
  pngPath: string;
  diffPath: string;
  metaPath: string;
  timestamp: string;
};

const isoCompactNow = (): string =>
  new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "Z");

export const newHistoryEntry = (paths: StoragePaths, hash: string): HistoryEntry => {
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
  paths: StoragePaths,
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
    ]),
  );
};

export const updateIndex = async (
  paths: StoragePaths,
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
