#!/usr/bin/env bun
/**
 * Full flow board: screenshots joined by arrows, with highlight boxes and a
 * subtitle under each step. Reads a JSON spec, writes a PNG (and the HTML it
 * drew, next to it).
 *
 *   bun ~/.claude/skills/full-flow/render.ts <spec.json> [--out board.png] [--scale 1.5]
 *
 * Spec (paths are relative to the spec file):
 * {
 *   "title": "Seller applications",
 *   "subtitle": "What happens from sign-up to an approved seller",
 *   "meta": "Built 19 Nov 2026 · production 680dbee4",
 *   "width": 2600,                       // optional page width in px
 *   "lanes": [
 *     { "id": "signup", "label": "A business signs up", "join": true, "steps": [   // join: false = alternatives, no arrows
 *       { "id": "form", "image": "shots/register.png", "frame": "desktop" | "phone",
 *         "title": "Fill in the sign-up form",
 *         "subtitle": "example.com/register. Business name, tax number, owner email and mobile.",
 *         "status": "live" | "staging" | "not-live" | "local",
 *         "statusText": "Live on production",          // optional, overrides the default words
 *         "highlights": [ { "box": [0.1, 0.2, 0.5, 0.1], "label": "ABN" } ],  // x, y, w, h as 0..1 of the image
 *         "crop": [0, 0, 1, 0.6],                       // optional: x, y, w, h as 0..1, shows only that part
 *         "via": "Scroll down",                         // optional: label on the arrow into this step
 *         "emptyText": "Not captured yet"               // optional: grey-box text for a step with no image
 *       } ] }
 *   ],
 *   "edges": [ { "from": "form", "to": "email", "label": "Submit" } ]   // extra arrows; steps in a lane are joined in order
 * }
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

type Highlight = { box: [number, number, number, number]; label?: string };
type Step = {
  id: string;
  image?: string;
  frame?: "desktop" | "phone";
  title: string;
  subtitle?: string;
  status?: "live" | "staging" | "not-live" | "local";
  statusText?: string;
  highlights?: Highlight[];
  crop?: [number, number, number, number];
  /** Label on the arrow into this step from the step before it in its lane ("Scroll down", "Tap Save"). */
  via?: string;
  /** Text in the grey box when the step has no image (default: "No screen: happens in the background"). */
  emptyText?: string;
};
/** join: false when the lane's steps are alternatives, not a sequence (no arrows between them). */
type Lane = { id: string; label: string; steps: Step[]; join?: boolean };
type Edge = { from: string; to: string; label?: string; dashed?: boolean };
type Spec = { title: string; subtitle?: string; meta?: string; width?: number; lanes: Lane[]; edges?: Edge[] };

const args = process.argv.slice(2);
const specPath = args.find((arg) => !arg.startsWith("--"));
if (!specPath) {
  console.error("usage: bun render.ts <spec.json> [--out board.png] [--scale 1.5]");
  process.exit(2);
}
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const specFile = resolve(specPath);
const baseDir = dirname(specFile);
const spec = JSON.parse(readFileSync(specFile, "utf8")) as Spec;
const out = resolve(flag("out") ?? join(baseDir, "full-flow.png"));
const scale = Number(flag("scale") ?? "1.5");

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fileUrl = (path: string) => pathToFileURL(isAbsolute(path) ? path : join(baseDir, path)).href;

const statusWords: Record<NonNullable<Step["status"]>, string> = {
  live: "Live on production",
  staging: "On Staging only",
  "not-live": "Not live yet",
  local: "Local build only",
};

let stepNumber = 0;
const card = (step: Step) => {
  stepNumber += 1;
  const crop = step.crop ?? [0, 0, 1, 1];
  const highlights = (step.highlights ?? [])
    .map((h, index) => {
      // Highlight boxes are given against the whole image; map them into the crop.
      const [x, y, w, hh] = h.box;
      const left = ((x - crop[0]) / crop[2]) * 100;
      const top = ((y - crop[1]) / crop[3]) * 100;
      const width = (w / crop[2]) * 100;
      const height = (hh / crop[3]) * 100;
      return `<div class="hl" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%">
        <span class="hl-tag">${index + 1}${h.label ? ` · ${escape(h.label)}` : ""}</span></div>`;
    })
    .join("");
  const image = step.image
    ? `<div class="shot ${step.frame ?? "desktop"}"><div class="crop" data-crop="${crop.join(",")}">
         <img src="${fileUrl(step.image)}" alt="">
         <div class="hl-layer">${highlights}</div></div></div>`
    : `<div class="shot empty"><span>${escape(step.emptyText ?? "No screen: happens in the background")}</span></div>`;
  const status = step.status
    ? `<span class="status ${step.status}">${escape(step.statusText ?? statusWords[step.status])}</span>`
    : "";
  return `<article class="card" id="step-${escape(step.id)}">
    <header><span class="num">${stepNumber}</span><h3>${escape(step.title)}</h3>${status}</header>
    ${image}
    ${step.subtitle ? `<p class="sub">${escape(step.subtitle)}</p>` : ""}
  </article>`;
};

const lanes = spec.lanes
  .map(
    (lane) => `<section class="lane" id="lane-${escape(lane.id)}">
      <h2>${escape(lane.label)}</h2>
      <div class="row">${lane.steps.map(card).join("")}</div>
    </section>`,
  )
  .join("");

const edges: Edge[] = [
  ...spec.lanes
    .filter((lane) => lane.join !== false)
    .flatMap((lane) =>
      lane.steps.slice(1).map((step, index) => ({ from: lane.steps[index]!.id, to: step.id, label: step.via })),
    ),
  ...(spec.edges ?? []),
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root { --ink:#16181d; --muted:#5b6170; --line:#d9dce3; --bg:#f4f5f8; --card:#fff; --accent:#e5484d; --arrow:#3b5bdb; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.45 -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; }
  .page { width:${spec.width ?? 2600}px; padding:56px 64px 72px 96px; position:relative; }
  .top h1 { font-size:40px; line-height:1.1; margin:0 0 8px; letter-spacing:-0.02em; }
  .top p { margin:0; color:var(--muted); font-size:19px; }
  .top .meta { margin-top:6px; font-size:15px; }
  .lane { margin-top:48px; }
  .lane h2 { font-size:15px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin:0 0 16px; position:relative; z-index:1; display:inline-block; background:var(--bg); padding:2px 10px 2px 0; }
  .row { display:flex; gap:96px; align-items:flex-start; flex-wrap:wrap; row-gap:56px; }
  .card { width:520px; background:var(--card); border:1px solid var(--line); border-radius:18px; padding:18px; box-shadow:0 1px 2px rgba(16,24,40,.04), 0 8px 24px rgba(16,24,40,.06); position:relative; z-index:1; }
  .card header { display:flex; align-items:center; gap:10px; margin-bottom:14px; flex-wrap:wrap; }
  .num { width:30px; height:30px; border-radius:50%; background:var(--ink); color:#fff; font-weight:700; font-size:15px; display:grid; place-items:center; flex:none; }
  .card h3 { margin:0; font-size:19px; line-height:1.25; flex:1 1 200px; }
  .status { font-size:12.5px; font-weight:600; padding:3px 9px; border-radius:999px; white-space:nowrap; }
  .status.live { background:#e6f6ec; color:#16652f; } .status.staging { background:#fff4d6; color:#7a4d00; }
  .status.not-live { background:#f1f2f5; color:#4a5060; } .status.local { background:#eef2ff; color:#3442a8; }
  .shot { border-radius:12px; overflow:hidden; background:#eceef3; border:1px solid var(--line); display:grid; place-items:center; }
  .shot.phone { padding:14px 0; } .shot.phone .crop { width:62%; border-radius:22px; overflow:hidden; box-shadow:0 4px 18px rgba(0,0,0,.18); }
  .shot.desktop .crop { width:100%; }
  .shot.empty { height:200px; color:var(--muted); font-size:15px; border-style:dashed; }
  .crop { position:relative; overflow:hidden; }
  .crop img { position:absolute; display:block; }
  .hl-layer { position:absolute; inset:0; }
  .hl { position:absolute; border:3px solid var(--accent); border-radius:8px; box-shadow:0 0 0 4px rgba(229,72,77,.18); }
  .hl-tag { position:absolute; left:-3px; top:-30px; background:var(--accent); color:#fff; font-size:13px; font-weight:700; padding:3px 8px; border-radius:6px; white-space:nowrap; }
  .sub { margin:14px 2px 2px; font-size:16.5px; line-height:1.45; }
  svg.edges { position:absolute; inset:0; pointer-events:none; overflow:visible; z-index:0; }
  .edge { fill:none; stroke:var(--arrow); stroke-width:3.5; stroke-linejoin:round; }
  .edge.dashed { stroke-dasharray:9 8; }
  .edge-label { font-size:14px; font-weight:700; fill:var(--arrow); }
  .edge-label-bg { fill:var(--bg); }
</style></head><body><div class="page" id="page">
  <div class="top"><h1>${escape(spec.title)}</h1>${spec.subtitle ? `<p>${escape(spec.subtitle)}</p>` : ""}${spec.meta ? `<p class="meta">${escape(spec.meta)}</p>` : ""}</div>
  ${lanes}
  <svg class="edges" id="edges"><defs><marker id="head" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3b5bdb"/></marker></defs></svg>
</div>
<script>
  window.__edges = ${JSON.stringify(edges)};
  window.layoutBoard = () => {
    // Size each crop to its image's shape, then place the image so only the crop shows.
    for (const crop of document.querySelectorAll(".crop")) {
      const img = crop.querySelector("img");
      const [cx, cy, cw, ch] = crop.dataset.crop.split(",").map(Number);
      const width = crop.clientWidth;
      const ratio = (img.naturalHeight * ch) / (img.naturalWidth * cw);
      crop.style.height = width * ratio + "px";
      img.style.width = width / cw + "px";
      img.style.left = (-cx * width) / cw + "px";
      img.style.top = (-cy * img.naturalHeight * (width / cw)) / img.naturalWidth + "px";
    }
    const page = document.getElementById("page").getBoundingClientRect();
    const svg = document.getElementById("edges");
    svg.setAttribute("width", page.width); svg.setAttribute("height", page.height);
    const lanes = [...document.querySelectorAll(".lane")];
    const box = (id) => { const el = document.getElementById("step-" + id); const r = el.getBoundingClientRect();
      const lane = el.closest(".lane"); const lr = lane.getBoundingClientRect();
      return { l: r.left - page.left, r: r.right - page.left, t: r.top - page.top, b: r.bottom - page.top, cx: r.left - page.left + r.width / 2,
        cy: r.top - page.top + Math.min(r.height / 2, 220), lane: lanes.indexOf(lane), laneBottom: lr.bottom - page.top }; };
    const ns = "http://www.w3.org/2000/svg";
    let gutterCount = 0;
    for (const edge of window.__edges) {
      const a = box(edge.from), b = box(edge.to);
      let d, mx, my, anchor = "middle";
      if (Math.abs(a.t - b.t) < 40 && b.l > a.r) {           // same row, left to right
        d = "M" + a.r + "," + a.cy + " L" + (b.l - 4) + "," + b.cy; mx = (a.r + b.l) / 2; my = a.cy - 14;
      } else if (b.lane - a.lane >= 2) {
        // Skips a row: a straight line would run behind the cards between, so it
        // drops into the gap under its own row and runs down the left margin.
        const gx = 26 + 14 * gutterCount++, gap = a.laneBottom + 22, ey = b.cy;
        d = "M" + a.cx + "," + a.b + " V" + gap + " H" + gx + " V" + ey + " H" + (b.l - 4);
        mx = Math.max(gx + 70, a.cx - 70); my = gap - 8;
      } else if (b.t > a.b) {                                  // down to the next row
        const sx = a.cx, sy = a.b, ex = b.cx, ey = b.t - 4, mid = (sy + ey) / 2;
        d = "M" + sx + "," + sy + " C" + sx + "," + mid + " " + ex + "," + mid + " " + ex + "," + ey;
        mx = sx + 10; my = sy + 24; anchor = "start";          // label by its source, so arrows that meet keep their own labels
      } else {                                                 // goes up or back
        const sx = a.cx, sy = a.t, ex = b.cx, ey = b.b + 4, mid = (sy + ey) / 2;
        d = "M" + sx + "," + sy + " C" + sx + "," + mid + " " + ex + "," + mid + " " + ex + "," + ey; mx = (sx + ex) / 2; my = mid - 8;
      }
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", d); path.setAttribute("class", "edge" + (edge.dashed ? " dashed" : "")); path.setAttribute("marker-end", "url(#head)");
      svg.appendChild(path);
      if (edge.label) {
        const text = document.createElementNS(ns, "text");
        text.setAttribute("x", mx); text.setAttribute("y", my); text.setAttribute("text-anchor", anchor); text.setAttribute("class", "edge-label");
        text.textContent = edge.label; svg.appendChild(text);
        const bb = text.getBBox(); const bg = document.createElementNS(ns, "rect");
        bg.setAttribute("x", bb.x - 6); bg.setAttribute("y", bb.y - 3); bg.setAttribute("width", bb.width + 12); bg.setAttribute("height", bb.height + 6); bg.setAttribute("rx", 6); bg.setAttribute("class", "edge-label-bg");
        svg.insertBefore(bg, text);
      }
    }
  };
</script></body></html>`;

mkdirSync(dirname(out), { recursive: true });
const htmlPath = out.replace(/\.png$/i, "") + ".html";
writeFileSync(htmlPath, html);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: (spec.width ?? 2600) + 0, height: 1200 }, deviceScaleFactor: scale });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 30_000 })
    .catch(() => { throw new Error("An image did not load: check the paths in the spec."); });
  await page.evaluate(() => (window as unknown as { layoutBoard: () => void }).layoutBoard());
  await page.locator("#page").screenshot({ path: out });
  console.log(`wrote ${out}\nwrote ${htmlPath}`);
} finally {
  await browser.close();
}
