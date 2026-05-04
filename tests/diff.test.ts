import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { comparePngs } from "../src/diff.js";

const makePng = (width: number, height: number, fill: [number, number, number, number]): Buffer => {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = fill[0];
      png.data[idx + 1] = fill[1];
      png.data[idx + 2] = fill[2];
      png.data[idx + 3] = fill[3];
    }
  }
  return PNG.sync.write(png);
};

const paintRect = (
  buf: Buffer,
  width: number,
  rect: { x: number; y: number; w: number; h: number },
  color: [number, number, number, number],
): Buffer => {
  const png = PNG.sync.read(buf);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = color[3];
    }
  }
  return PNG.sync.write(png);
};

describe("comparePngs", () => {
  it("returns ratio 0 and no diff image for identical PNGs", () => {
    const a = makePng(20, 20, [255, 0, 0, 255]);
    const b = makePng(20, 20, [255, 0, 0, 255]);
    const result = comparePngs(a, b);
    expect(result.ratio).toBe(0);
    expect(result.diffPng).toBeNull();
    expect(result.sizeMismatch).toBe(false);
  });

  it("detects partial differences and produces a diff image", () => {
    const base = makePng(20, 20, [255, 255, 255, 255]);
    const modified = paintRect(
      makePng(20, 20, [255, 255, 255, 255]),
      20,
      { x: 0, y: 0, w: 5, h: 5 },
      [0, 0, 0, 255],
    );
    const result = comparePngs(base, modified);
    expect(result.ratio).toBeGreaterThan(0);
    expect(result.ratio).toBeLessThan(1);
    expect(result.diffPng).not.toBeNull();
  });

  it("returns ratio 1 and sizeMismatch=true when sizes differ", () => {
    const a = makePng(10, 10, [0, 0, 0, 255]);
    const b = makePng(20, 10, [0, 0, 0, 255]);
    const result = comparePngs(a, b);
    expect(result.ratio).toBe(1);
    expect(result.sizeMismatch).toBe(true);
    expect(result.diffPng).toBeNull();
  });

  it("returns ratio close to 1 when images are completely different", () => {
    const a = makePng(20, 20, [0, 0, 0, 255]);
    const b = makePng(20, 20, [255, 255, 255, 255]);
    const result = comparePngs(a, b);
    expect(result.ratio).toBeGreaterThan(0.9);
  });
});
