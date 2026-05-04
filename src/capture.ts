import { type Browser, chromium } from "playwright";
import type { Viewport } from "./types.js";

let browserPromise: Promise<Browser> | null = null;

const getBrowser = (): Promise<Browser> => {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browserPromise;
};

export const closeBrowser = async (): Promise<void> => {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
};

export type CaptureOptions = {
  url: string;
  viewport: Viewport;
  navigationTimeoutMs: number;
};

export const captureUrl = async (opts: CaptureOptions): Promise<Buffer> => {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: opts.viewport });
  try {
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(opts.navigationTimeoutMs);
    await page.goto(opts.url, { waitUntil: "networkidle" });
    return await page.screenshot({ fullPage: true, type: "png" });
  } finally {
    await context.close();
  }
};
