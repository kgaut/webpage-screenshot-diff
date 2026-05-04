import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export type DiffResult = {
  ratio: number;
  diffPng: Buffer | null;
  sizeMismatch: boolean;
};

export const comparePngs = (baseline: Buffer, current: Buffer): DiffResult => {
  const a = PNG.sync.read(baseline);
  const b = PNG.sync.read(current);

  if (a.width !== b.width || a.height !== b.height) {
    return { ratio: 1, diffPng: null, sizeMismatch: true };
  }

  const { width, height } = a;
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: 0.1,
    includeAA: false,
  });

  const total = width * height;
  const ratio = total === 0 ? 0 : mismatched / total;
  return {
    ratio,
    diffPng: mismatched > 0 ? PNG.sync.write(diff) : null,
    sizeMismatch: false,
  };
};
