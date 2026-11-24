/**
 * The tour file: the only thing an agent writes for a new video. Everything else (look, timing, layout) is fixed in
 * style.ts so every walkthrough looks the same. See examples/ for complete tours.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import YAML from "yaml";

/** Where a step acts. A bare string in a step means `{ text: "<string>" }`. */
export type Target = {
  text?: string;
  id?: string; // phone: accessibility id
  point?: [number, number]; // phone: device points
  role?: string; // web: ARIA role, with `name`
  name?: string;
  selector?: string; // web: CSS
  label?: string; // web: form label
  in?: string; // web: CSS of a container to search inside
  inText?: string; // web: the container must contain this text
  index?: number; // the nth match, from 0
  exact?: boolean; // web text match, default true
};

export type Step = Record<string, unknown>;

export type Scene = {
  id: string;
  on: "phone" | "web" | "card";
  label?: string;
  subtitle?: string;
  title?: string; // card
  lines?: string[]; // card; **bold** allowed
  seconds?: number; // card
  setup?: Step[]; // off camera
  steps?: Step[]; // on camera
  minimum?: number; // seconds; default from the subtitle's length
  say?: string; // voice-over text; default the subtitle (a card: title and lines); "" for silence
};

export type Tour = {
  file: string; // the tour file, absolute
  dir: string;
  title: string;
  brand: string; // the small mark above card titles; empty for none
  out: string; // MP4, absolute
  work: string; // take folder, absolute
  phone?: { device?: string; appId: string; label: string; statusBar: boolean };
  web?: {
    url: string;
    cookies?: string;
    storageState?: string;
    hide: string[];
    label: string;
  };
  voice?: { speaker: string; speed: number; pronounce: Record<string, string> }; // spoken voice-over, made locally
  scenes: Scene[];
};

const expand = (dir: string, path: string) => {
  const home = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  return isAbsolute(home) ? home : resolve(dir, home);
};

export const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** How long a scene stays on screen at least: long enough to read its subtitle twice over. */
export function minimumSeconds(scene: Scene) {
  if (scene.minimum) return scene.minimum;
  return Math.max(3.6, 1.4 + 0.28 * words(scene.subtitle ?? ""));
}

const phoneSteps = new Set(["tap", "wait", "swipe", "hold"]);
const phoneSetup = new Set(["launch", "open", "shell", "hold"]);
const webSteps = new Set(["goto", "click", "hover", "fill", "wait", "scroll", "hold", "close", "reload", "shell"]);

export type Problem = { level: "error" | "warn"; where: string; text: string };

export function loadTour(path: string): { tour: Tour; problems: Problem[] } {
  const file = resolve(path);
  const dir = dirname(file);
  const raw = YAML.parse(readFileSync(file, "utf8")) as Record<string, any>;
  const problems: Problem[] = [];
  const err = (where: string, text: string) => problems.push({ level: "error", where, text });
  const warn = (where: string, text: string) => problems.push({ level: "warn", where, text });

  if (!raw?.title) err("tour", "title is required");
  if (!raw?.out) err("tour", "out (the MP4 path) is required");
  const name = basename(file).replace(/\.ya?ml$/, "");
  const slug = name === "tour" ? basename(dir) : name;
  const tour: Tour = {
    file,
    dir,
    title: String(raw?.title ?? ""),
    brand: String(raw?.brand ?? ""),
    out: expand(dir, String(raw?.out ?? "walkthrough.mp4")),
    work: expand(dir, String(raw?.work ?? `~/.cache/full-flow-video/${slug}`)),
    phone: raw?.phone
      ? {
          device: raw.phone.device,
          appId: String(raw.phone.appId ?? ""),
          label: String(raw.phone.label ?? "iPhone"),
          statusBar: raw.phone.statusBar !== false,
        }
      : undefined,
    web: raw?.web
      ? {
          // A path with no scheme is a local HTML file next to the tour.
          url: /^[a-z]+:/i.test(String(raw.web.url ?? "")) ? String(raw.web.url) : `file://${expand(dir, String(raw.web.url ?? ""))}`,
          cookies: raw.web.cookies ? expand(dir, String(raw.web.cookies)) : undefined,
          storageState: raw.web.storageState ? expand(dir, String(raw.web.storageState)) : undefined,
          hide: (raw.web.hide as string[] | undefined) ?? [],
          label: String(raw.web.label ?? "Web"),
        }
      : undefined,
    voice: raw?.voice
      ? {
          speaker: String(raw.voice === true ? "af_heart" : (raw.voice.speaker ?? "af_heart")),
          speed: Number(raw.voice === true ? 0.9 : (raw.voice.speed ?? 0.9)),
          pronounce: (raw.voice === true ? {} : (raw.voice.pronounce ?? {})) as Record<string, string>,
        }
      : undefined,
    scenes: [],
  };

  const scenes: Scene[] = [];
  if (raw?.intro) scenes.push({ id: "intro", on: "card", ...raw.intro });
  for (const item of (raw?.scenes as Scene[] | undefined) ?? []) scenes.push(item);
  if (raw?.outro) scenes.push({ id: "outro", on: "card", ...raw.outro });
  tour.scenes = scenes;

  const seen = new Set<string>();
  for (const [index, scene] of scenes.entries()) {
    const where = `scene ${index + 1} (${scene.id ?? "no id"})`;
    if (!scene.id) err(where, "id is required");
    if (seen.has(scene.id)) err(where, "id is used twice");
    seen.add(scene.id);
    if (!["phone", "web", "card"].includes(scene.on)) err(where, "on must be phone, web or card");
    if (scene.on === "card") {
      if (!scene.title) err(where, "a card needs a title");
      if ((scene.lines ?? []).length > 3) warn(where, "a card reads best with 1 to 3 lines");
      continue;
    }
    if (!scene.subtitle) err(where, "subtitle is required");
    else if (words(scene.subtitle) > 12) warn(where, `subtitle has ${words(scene.subtitle)} words; keep it to 12`);
    if (/[–—]/.test(scene.subtitle ?? "")) err(where, "no en or em dashes in subtitles");
    if (/[–—]/.test(scene.say ?? "")) err(where, "no en or em dashes in say");
    if (!(scene.steps ?? []).length) err(where, "steps are required: a scene shows something happen");
    if (scene.on === "phone" && !tour.phone?.appId) err(where, "a phone scene needs phone.appId at the top");
    if (scene.on === "web" && !tour.web?.url) err(where, "a web scene needs web.url at the top");
    const allowedSteps = scene.on === "phone" ? phoneSteps : webSteps;
    const allowedSetup = scene.on === "phone" ? phoneSetup : webSteps;
    for (const [kind, list, allowed] of [["setup", scene.setup, allowedSetup], ["steps", scene.steps, allowedSteps]] as const) {
      for (const step of list ?? []) {
        const key = Object.keys(step).find((name) => allowed.has(name));
        if (!key) err(where, `${kind}: unknown step ${JSON.stringify(step)} (allowed: ${[...allowed].join(", ")})`);
        if (step.fill && typeof step.fill === "object" && !("value" in (step.fill as object))) err(where, "fill needs value");
        if (step.type) err(where, "no typing on camera: use fill, which sets the value in one go");
      }
    }
    const clicks = (scene.steps ?? []).filter((step) => step.click && step.popup);
    if (clicks.length > 1 || (clicks.length === 1 && scene.steps!.at(-1) !== clicks[0])) {
      err(where, "a click with popup: true must be the scene's last step; the next scene runs in the new tab");
    }
  }
  return { tour, problems };
}

export const asTarget = (value: unknown): Target =>
  typeof value === "string" ? { text: value } : ((value ?? {}) as Target);
