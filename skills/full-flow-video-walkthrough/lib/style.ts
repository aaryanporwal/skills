/**
 * The fixed look of every walkthrough (first used for the merchant KYC tour, 17 Nov 2026). Change it here, never
 * per tour: the point is that every video looks the same.
 */
import type { Browser } from "playwright";

export const W = 1440;
export const H = 900;
export const FPS = 30;
export const FADE = 0.4; // cross-fade between scenes, seconds
export const ENCODE = ["-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-r", String(FPS)];

// Timing of the cut. A still stretch longer than MAX_IDLE is shortened, keeping LEAD before the next change (so a
// tap's ring shows before the screen reacts). Scenes get BEFORE of the screen before their first action and AFTER
// of the result after their last.
export const MAX_IDLE = 1.1;
export const LEAD = 0.55;
export const BEFORE = 1.0;
export const AFTER = 1.1;

const colors = { paper: "#f3f1ea", ink: "#12301f", body: "#33473b", accent: "#1d6b3c", dot: "#2c8a4e" };
const font = `-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif`;

// The phone: a 1206 x 2622 recording (iPhone 17 Pro, 402 x 874 points) in a 394 x 856 screen with a 13 px bezel,
// left of centre; the subtitle sits to its right.
export const SCREEN = { x: 236, y: 22, w: 394, h: 856, radius: 54 };
export const BEZEL = 13;

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const bold = (text: string) => escape(text).replace(/\*\*(.+?)\*\*/g, "<b style=\"color:" + colors.ink + "\">$1</b>");

export function cardHtml(brand: string, title: string, lines: string[]) {
  const mark = brand
    ? `<div style="display:inline-flex;align-items:center;gap:12px;font-weight:700;font-size:26px;color:${colors.accent};margin-bottom:34px">
        <i style="width:16px;height:16px;border-radius:50%;background:${colors.dot};display:inline-block"></i>${escape(brand)}</div>`
    : "";
  return `<div style="height:${H}px;display:grid;place-items:center;background:${colors.paper};color:${colors.ink}">
    <main style="width:1040px">
      ${mark}
      <h1 style="font-size:66px;line-height:1.08;letter-spacing:-.03em;margin:0 0 34px">${escape(title)}</h1>
      ${lines.map((line) => `<p style="font-size:31px;line-height:1.4;margin:0 0 16px;color:${colors.body}">${bold(line)}</p>`).join("")}
    </main></div>`;
}

export function phoneHtml(label: string, subtitle: string) {
  const b = { x: SCREEN.x - BEZEL, y: SCREEN.y - BEZEL, w: SCREEN.w + BEZEL * 2, h: SCREEN.h + BEZEL * 2 };
  return `<div style="position:relative;width:${W}px;height:${H}px;background:${colors.paper};overflow:hidden">
    <div style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border-radius:${SCREEN.radius + BEZEL}px;
      background:#16181a;box-shadow:0 30px 70px rgba(18,48,31,.18),0 0 0 2px #3a3d40 inset"></div>
    <div style="position:absolute;left:720px;top:0;width:620px;height:${H}px;display:flex;flex-direction:column;justify-content:center">
      <div style="font-size:18px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${colors.accent};margin-bottom:18px">${escape(label)}</div>
      <div style="font-size:44px;line-height:1.22;font-weight:650;letter-spacing:-.02em;color:${colors.ink}">${escape(subtitle)}</div>
    </div></div>`;
}

export function barHtml(label: string, subtitle: string) {
  return `<div style="position:relative;width:${W}px;height:${H}px">
    <div style="position:absolute;left:50%;bottom:34px;transform:translateX(-50%);max-width:1120px;padding:14px 30px 16px;border-radius:16px;
      background:rgba(16,28,22,.9);color:#fff;text-align:center;white-space:nowrap;box-shadow:0 10px 32px rgba(0,0,0,.22)">
      <div style="font-size:14px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9fe3b4;margin-bottom:6px">${escape(label)}</div>
      <div style="font-size:28px;line-height:1.3;font-weight:600;letter-spacing:-.01em">${escape(subtitle)}</div>
    </div></div>`;
}

export function maskHtml() {
  return `<div style="width:${SCREEN.w}px;height:${SCREEN.h}px;background:#000"><div style="width:100%;height:100%;
    border-radius:${SCREEN.radius}px;background:#fff"></div></div>`;
}

export function ringHtml() {
  return `<div style="width:76px;height:76px;display:grid;place-items:center"><div style="width:58px;height:58px;border-radius:50%;
    border:4px solid rgba(232,120,20,.95);background:rgba(232,120,20,.25);box-sizing:border-box"></div></div>`;
}

export async function png(browser: Browser, html: string, file: string, options: { transparent?: boolean; width?: number; height?: number } = {}) {
  const page = await browser.newPage({ viewport: { width: options.width ?? W, height: options.height ?? H } });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:${options.transparent ? "transparent" : colors.paper}}
    body{font-family:${font};-webkit-font-smoothing:antialiased}</style></head><body>${html}</body></html>`);
  await page.screenshot({ path: file, omitBackground: options.transparent });
  await page.close();
  return file;
}

/** Drawn into every recorded web page: a cursor, a ring on each press, and no development chrome. */
export function webOverlay(hide: string[]) {
  const install = () => {
    if (document.getElementById("fvw-cursor")) return;
    if (document.contentType.startsWith("image/")) return; // a file tab: nothing to point at
    const style = document.createElement("style");
    style.textContent = `
      nextjs-portal, ${hide.length ? hide.join(", ") : "fvw-none"} { display: none !important; }
      #fvw-cursor { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 30px; height: 30px; pointer-events: none;
        transform: translate(-200px, -200px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
      .fvw-ring { position: fixed; z-index: 2147483646; width: 48px; height: 48px; margin: -24px 0 0 -24px; border-radius: 50%;
        border: 3px solid rgba(232,120,20,.95); background: rgba(232,120,20,.22); pointer-events: none;
        animation: fvw-ring .7s ease-out forwards; }
      @keyframes fvw-ring { from { transform: scale(.35); opacity: 1 } to { transform: scale(1.7); opacity: 0 } }`;
    document.documentElement.appendChild(style);
    const cursor = document.createElement("div");
    cursor.id = "fvw-cursor";
    cursor.innerHTML = '<svg viewBox="0 0 30 30" width="30" height="30"><path d="M6 3 L6 24 L11.2 19.2 L15 27.2 L18.8 25.6 L15.1 17.8 L22 17.6 Z" fill="#141414" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(cursor);
    const place = (x: number, y: number) => { cursor.style.transform = `translate(${x - 6}px, ${y - 3}px)`; };
    const last = (window as unknown as { __fvwPointer?: { x: number; y: number } }).__fvwPointer;
    if (last) place(last.x, last.y);
    addEventListener("mousemove", (event) => {
      (window as unknown as { __fvwPointer?: { x: number; y: number } }).__fvwPointer = { x: event.clientX, y: event.clientY };
      place(event.clientX, event.clientY);
    }, true);
    addEventListener("mousedown", (event) => {
      const ring = document.createElement("div");
      ring.className = "fvw-ring";
      ring.style.left = `${event.clientX}px`;
      ring.style.top = `${event.clientY}px`;
      document.documentElement.appendChild(ring);
      setTimeout(() => ring.remove(), 800);
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
}
