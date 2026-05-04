import { promises as fs } from "node:fs";
import type { Request, Response } from "express";
import { z } from "zod";
import type { Config } from "../config.js";
import { captureUrl } from "../capture.js";
import { mapConcurrent } from "../concurrency.js";
import { comparePngs } from "../diff.js";
import { sha256 } from "../hash.js";
import {
  buildProjectPaths,
  ensureLayout,
  ensureRoot,
  isValidProjectName,
  newHistoryEntry,
  readBaseline,
  recordProjectActivity,
  rotateHistory,
  updateIndex,
  writeBaseline,
  writeHistory,
  type ProjectPaths,
} from "../storage.js";
import type { DiffResponse, UrlResult } from "../types.js";

const viewportSchema = z.object({
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
});

const requestSchema = z.object({
  project: z
    .string()
    .min(1)
    .max(200)
    .refine(isValidProjectName, {
      message: "project must match [A-Za-z0-9._-] segments separated by '/'",
    }),
  threshold: z.number().min(0).max(100).default(0),
  updateBaselineOnFailure: z.boolean().default(false),
  viewport: viewportSchema.optional(),
  urls: z.array(z.string().url()).min(1).max(200),
});

export const makeDiffHandler = (config: Config) => {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
      return;
    }
    const { project, threshold, updateBaselineOnFailure, viewport, urls } = parsed.data;
    const effectiveViewport = viewport ?? config.defaultViewport;

    await ensureRoot(config.dataDir);
    const paths = buildProjectPaths(config.dataDir, project);
    await ensureLayout(paths);

    const results = await mapConcurrent<string, UrlResult>(
      urls,
      config.maxConcurrency,
      async (url) => processUrl(url, {
        config,
        paths,
        threshold,
        updateBaselineOnFailure,
        viewport: effectiveViewport,
      }),
    );

    await recordProjectActivity(config.dataDir, project, new Date().toISOString());

    const ok = results.every((r) => !r.thresholdExceeded && !r.error);
    const body: DiffResponse = { ok, project, threshold, results };
    res.status(ok ? 200 : 422).json(body);
  };
};

type ProcessCtx = {
  config: Config;
  paths: ProjectPaths;
  threshold: number;
  updateBaselineOnFailure: boolean;
  viewport: { width: number; height: number };
};

const processUrl = async (url: string, ctx: ProcessCtx): Promise<UrlResult> => {
  const hash = sha256(url);
  const entry = newHistoryEntry(ctx.paths, hash);

  let png: Buffer;
  try {
    png = await captureUrl({
      url,
      viewport: ctx.viewport,
      navigationTimeoutMs: ctx.config.navigationTimeoutMs,
    });
  } catch (err) {
    return {
      url,
      hash,
      created: false,
      diffRatio: 1,
      thresholdExceeded: true,
      screenshot: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const baseline = await readBaseline(ctx.paths, hash);
  const capturedAt = new Date().toISOString();
  const baseMeta = { url, hash, capturedAt, viewport: ctx.viewport };

  if (!baseline) {
    await writeHistory(entry, png, null, {
      ...baseMeta,
      created: true,
      diffRatio: 0,
      threshold: ctx.threshold,
      ok: true,
    });
    await writeBaseline(ctx.paths, hash, png, baseMeta);
    await updateIndex(ctx.paths, hash, url);
    await rotateHistory(ctx.paths, hash, ctx.config.historySize);
    return {
      url,
      hash,
      created: true,
      diffRatio: 0,
      thresholdExceeded: false,
      screenshot: entry.pngPath,
    };
  }

  const { ratio, diffPng } = comparePngs(baseline, png);
  const diffPercent = ratio * 100;
  const thresholdExceeded = diffPercent > ctx.threshold;

  await writeHistory(entry, png, diffPng, {
    ...baseMeta,
    created: false,
    diffRatio: ratio,
    threshold: ctx.threshold,
    ok: !thresholdExceeded,
  });

  if (!thresholdExceeded || ctx.updateBaselineOnFailure) {
    await writeBaseline(ctx.paths, hash, png, baseMeta);
  }

  await updateIndex(ctx.paths, hash, url);
  await rotateHistory(ctx.paths, hash, ctx.config.historySize);

  const result: UrlResult = {
    url,
    hash,
    created: false,
    diffRatio: ratio,
    thresholdExceeded,
    screenshot: entry.pngPath,
  };
  if (diffPng && (await fileExistsSafe(entry.diffPath))) {
    result.diffImage = entry.diffPath;
  }
  return result;
};

const fileExistsSafe = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};
