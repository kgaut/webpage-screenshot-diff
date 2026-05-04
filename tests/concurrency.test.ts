import { describe, expect, it } from "vitest";
import { mapConcurrent } from "../src/concurrency.js";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("mapConcurrent", () => {
  it("preserves the input order in results", async () => {
    const out = await mapConcurrent([1, 2, 3, 4, 5], 2, async (n) => {
      await wait(n % 2 === 0 ? 5 : 1);
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it("respects the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    await mapConcurrent(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        active++;
        peak = Math.max(peak, active);
        await wait(5);
        active--;
        return null;
      },
    );
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles an empty input", async () => {
    const out = await mapConcurrent<number, number>([], 4, async (n) => n);
    expect(out).toEqual([]);
  });

  it("propagates worker errors", async () => {
    await expect(
      mapConcurrent([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
