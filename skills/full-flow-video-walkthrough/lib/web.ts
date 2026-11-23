/**
 * Web scenes: Playwright drives a 1440 x 900 page and Chrome's screencast keeps every changed frame with its time.
 * A drawn cursor moves to each control and a ring shows each click. One browser lives for the whole tour, so a
 * signed-in session and page state carry from scene to scene.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Browser, type BrowserContext, type CDPSession, type Locator, type Page } from "playwright";

import { asTarget, type Scene, type Step, type Target, type Tour } from "./spec";
import { AFTER, BEFORE, H, W, webOverlay } from "./style";
import type { Frame, Hold } from "./timeline";

export type WebShot = { id: string; frames: string; start: number; end: number; holds: Hold[] };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const slow = 45000;

class Tape {
  frames: Frame[] = [];
  private cdp!: CDPSession;
  constructor(readonly page: Page, readonly dir: string) {}
  async start() {
    mkdirSync(this.dir, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
      const file = join(this.dir, `${String(this.frames.length).padStart(6, "0")}.jpg`);
      writeFileSync(file, Buffer.from(data, "base64"));
      this.frames.push({ t: metadata.timestamp ?? Date.now() / 1000, file });
      await this.cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 94, maxWidth: W, maxHeight: H });
  }
  async stop() {
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    writeFileSync(join(this.dir, "frames.json"), JSON.stringify(this.frames));
  }
}

export class WebRunner {
  private browser!: Browser;
  private context!: BrowserContext;
  private main!: Page;
  private page!: Page;
  private tapes = new Map<Page, Tape>();
  private pointer = { x: 900, y: 500 };
  private tapeCount = 0;

  constructor(private readonly tour: Tour, private readonly dir: string) {}

  async open() {
    const web = this.tour.web!;
    this.browser = await chromium.launch();
    this.context = await this.browser.newContext({
      viewport: { width: W, height: H },
      colorScheme: "light",
      reducedMotion: "no-preference",
      ...(web.storageState ? { storageState: web.storageState } : {}),
    });
    if (web.cookies) {
      const values = JSON.parse(readFileSync(web.cookies, "utf8")) as Record<string, string>;
      const host = new URL(web.url).hostname;
      await this.context.addCookies(Object.entries(values).map(([name, value]) => ({ name, value, domain: host, path: "/" })));
    }
    await this.context.addInitScript(webOverlay, web.hide);
    this.main = await this.context.newPage();
    this.page = this.main;
    await this.tape(this.main);
  }

  private async tape(page: Page) {
    const tape = new Tape(page, join(this.dir, `page-${this.tapeCount++}`));
    await tape.start();
    this.tapes.set(page, tape);
  }

  async close() {
    for (const tape of this.tapes.values()) await tape.stop();
    await this.browser?.close();
  }

  private locate(value: unknown): Locator {
    const target: Target = asTarget(value);
    const scope = target.in ? this.page.locator(target.in, target.inText ? { hasText: target.inText } : undefined) : this.page;
    let found: Locator;
    if (target.selector) found = scope.locator(target.selector);
    else if (target.role) found = scope.getByRole(target.role as never, { name: target.name, exact: target.exact ?? false });
    else if (target.label) found = scope.getByLabel(target.label, { exact: target.exact ?? true });
    else if (target.text) found = scope.getByText(target.text, { exact: target.exact ?? true });
    else throw new Error(`no target in ${JSON.stringify(value)}`);
    return target.index !== undefined ? found.nth(target.index) : found.first();
  }

  private async settle(ms = 700) {
    await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await wait(ms);
    await this.page.evaluate((p) => {
      (window as unknown as { __fvwPointer?: { x: number; y: number } }).__fvwPointer = p;
      const cursor = document.getElementById("fvw-cursor");
      if (cursor) cursor.style.transform = `translate(${p.x - 6}px, ${p.y - 3}px)`;
    }, this.pointer).catch(() => {});
  }

  private async moveTo(target: Locator) {
    await target.waitFor({ timeout: slow });
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error("target has no box on screen");
    const to = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    const from = this.pointer;
    for (let i = 1; i <= 30; i += 1) {
      const k = i / 30;
      const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      await this.page.mouse.move(from.x + (to.x - from.x) * ease, from.y + (to.y - from.y) * ease);
      await wait(16);
    }
    this.pointer = to;
  }

  private async step(step: Step, holds: Hold[]) {
    const web = this.tour.web!;
    if (step.goto !== undefined) {
      await this.page.goto(new URL(String(step.goto), web.url).toString(), { waitUntil: "networkidle", timeout: 60000 });
      await this.settle(900);
    } else if (step.click !== undefined) {
      const target = this.locate(step.click);
      await this.moveTo(target);
      await wait(380);
      const popup = step.popup ? this.context.waitForEvent("page") : undefined;
      await this.page.mouse.down();
      await wait(90);
      await this.page.mouse.up();
      if (popup) {
        const tab = await popup;
        await tab.waitForLoadState("load");
        await fitImage(tab);
        this.page = tab;
        await this.tape(tab);
        await wait(600);
      } else {
        await this.settle(700);
      }
    } else if (step.hover !== undefined) {
      await this.moveTo(this.locate(step.hover));
      await wait(500);
    } else if (step.fill !== undefined) {
      const fill = step.fill as Target & { value: string };
      await this.locate(fill).fill(fill.value); // in one go: no typing on camera
      await wait(900);
    } else if (step.wait !== undefined) {
      const value = step.wait as string | { text?: string; url?: string; selector?: string; gone?: string; timeout?: number };
      const spec = typeof value === "string" ? { text: value } : value;
      const timeout = spec.timeout ?? slow;
      if (spec.url) await this.page.waitForURL(new RegExp(spec.url), { timeout });
      if (spec.text) await this.page.getByText(spec.text).first().waitFor({ timeout });
      if (spec.selector) await this.page.locator(spec.selector).first().waitFor({ timeout });
      if (spec.gone) await this.page.getByText(spec.gone).first().waitFor({ state: "hidden", timeout });
      await this.settle(400);
    } else if (step.scroll !== undefined) {
      if (typeof step.scroll === "number") {
        await this.page.evaluate((dy) => new Promise<void>((resolve) => {
          const from = window.scrollY;
          const begin = performance.now();
          const tick = (now: number) => {
            const k = Math.min(1, (now - begin) / 1100);
            window.scrollTo(0, from + dy * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2));
            if (k < 1) requestAnimationFrame(tick); else resolve();
          };
          requestAnimationFrame(tick);
        }), step.scroll);
      } else {
        await this.locate(step.scroll).evaluate((element) => element.scrollIntoView({ behavior: "smooth", block: "center" }));
        await wait(900);
      }
    } else if (step.close) {
      if (this.page !== this.main) await this.page.close();
      this.page = this.main;
      await this.main.bringToFront();
      await this.main.evaluate(() => window.dispatchEvent(new Event("focus")));
      await this.settle(900);
    } else if (step.reload) {
      await this.page.reload({ waitUntil: "networkidle", timeout: 60000 });
      await this.settle(700);
    } else if (step.hold) {
      holds.push({ t: Date.now() / 1000, seconds: Number(step.hold) });
    } else if (step.shell) {
      execFileSync("/bin/bash", ["-c", String(step.shell)], { cwd: this.tour.dir, stdio: "inherit" });
    }
  }

  async scene(scene: Scene): Promise<WebShot> {
    const ignored: Hold[] = [];
    for (const step of scene.setup ?? []) await this.step(step, ignored);
    await this.settle(500);
    const tape = this.tapes.get(this.page)!;
    const start = Date.now() / 1000;
    const holds: Hold[] = [];
    await wait(BEFORE * 1000);
    for (const step of scene.steps ?? []) await this.step(step, holds);
    // The scene ends on the page it started on, unless its last step opened a new tab (that tab's scene comes next).
    await wait(AFTER * 1000);
    await this.page.evaluate(() => document.documentElement.getBoundingClientRect()).catch(() => {});
    await wait(80);
    return { id: scene.id, frames: tape.dir, start, end: Date.now() / 1000, holds };
  }
}

/** Chrome's own image tab: centre the whole file above the subtitle bar, on a dark page. */
async function fitImage(tab: Page) {
  await tab.evaluate(() => {
    if (!document.contentType.startsWith("image/")) return;
    const img = document.querySelector("img");
    if (!img) return;
    document.body.style.background = "#0e0e0e";
    img.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:140px;margin:auto;max-width:90vw;"
      + "max-height:calc(100vh - 180px);cursor:default";
  }).catch(() => {});
}
