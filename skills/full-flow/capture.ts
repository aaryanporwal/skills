#!/usr/bin/env bun
/**
 * Screenshot a public page for a full flow board (no sign-in; for signed-in
 * pages use the browser pane or the app's own screenshot tooling).
 *
 *   bun ~/.claude/skills/full-flow/capture.ts <url> <out.png> [--width 1200] [--height 900] [--full]
 *
 * Prints, as JSON, each element matched by --boxes "<css>,<css>" with its box
 * as fractions of the screenshot, ready to paste into a step's "highlights".
 */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const [url, out] = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
if (!url || !out) {
  console.error("usage: bun capture.ts <url> <out.png> [--width 1200] [--height 900] [--full] [--boxes css,css]");
  process.exit(2);
}
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const width = Number(flag("width") ?? 1200);
const height = Number(flag("height") ?? 900);
const full = args.includes("--full");
const selectors = (flag("boxes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1.5 });
  await page.goto(url, { waitUntil: "networkidle" });
  const size = full
    ? await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }))
    : { w: width, h: height };
  const boxes = [];
  for (const selector of selectors) {
    const box = await page.locator(selector).first().boundingBox();
    if (box) boxes.push({ selector, box: [box.x / size.w, box.y / size.h, box.width / size.w, box.height / size.h].map((n) => Number(n.toFixed(4))) });
  }
  await page.screenshot({ path: out, fullPage: full });
  console.log(JSON.stringify({ out, boxes }, null, 2));
} finally {
  await browser.close();
}
