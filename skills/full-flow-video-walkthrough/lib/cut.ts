/** Turns a take into the finished MP4 and SRT, in the fixed style. Re-run it after changing subtitles: no re-record. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { chromium } from "playwright";

import type { Take } from "./record";
import { minimumSeconds, type Tour } from "./spec";
import { barHtml, cardHtml, ENCODE, FADE, FPS, H, maskHtml, phoneHtml, png, ringHtml, SCREEN, W } from "./style";
import { concatList, plan, snapTap, type Frame } from "./timeline";

const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

export type Placed = { id: string; kind: string; subtitle: string; start: number; end: number };

export async function cut(tour: Tour, takeDir: string) {
  const take = JSON.parse(readFileSync(join(takeDir, "take.json"), "utf8")) as Take;
  const work = join(takeDir, "cut");
  mkdirSync(work, { recursive: true });
  const browser = await chromium.launch();
  const mask = await png(browser, maskHtml(), join(work, "mask.png"), { width: SCREEN.w, height: SCREEN.h });
  const ring = await png(browser, ringHtml(), join(work, "ring.png"), { transparent: true, width: 76, height: 76 });
  const frameCache = new Map<string, Frame[]>();
  const framesOf = (dir: string) => {
    if (!frameCache.has(dir)) frameCache.set(dir, JSON.parse(readFileSync(join(dir, "frames.json"), "utf8")) as Frame[]);
    return frameCache.get(dir)!;
  };

  const files: string[] = [];
  const lengths: number[] = [];
  for (const [index, scene] of tour.scenes.entries()) {
    const out = join(work, `${String(index).padStart(2, "0")}-${scene.id}.mp4`);
    const minimum = minimumSeconds(scene);
    if (scene.on === "card") {
      const still = await png(browser, cardHtml(tour.brand, scene.title ?? "", scene.lines ?? []), join(work, `${scene.id}.png`));
      const seconds = scene.seconds ?? 6;
      ffmpeg(["-loop", "1", "-t", String(seconds), "-i", still, "-vf", `fps=${FPS}`, ...ENCODE, out]);
      lengths.push(seconds);
    } else {
      const shot = take.shots.find((item) => item.id === scene.id);
      if (!shot) throw new Error(`the take has no scene ${scene.id}: record again after adding a scene`);
      const frames = framesOf(shot.frames);
      const timeline = plan(frames, shot.start, shot.end, shot.holds);
      const list = join(work, `${scene.id}.txt`);
      writeFileSync(list, concatList(timeline.pieces));
      const length = Math.max(timeline.length, minimum);
      const pad = (length - timeline.length).toFixed(3);
      if (scene.on === "web") {
        const bar = await png(browser, barHtml(scene.label ?? tour.web!.label, scene.subtitle ?? ""), join(work, `${scene.id}-bar.png`), { transparent: true });
        ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-loop", "1", "-i", bar, "-filter_complex",
          `[0:v]fps=${FPS},scale=${W}:${H}:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=${pad}[v];[v][1:v]overlay=0:0`,
          "-t", length.toFixed(3), ...ENCODE, out]);
      } else {
        const still = await png(browser, phoneHtml(scene.label ?? tour.phone!.label, scene.subtitle ?? ""), join(work, `${scene.id}.png`));
        const inputs = ["-loop", "1", "-i", still, "-f", "concat", "-safe", "0", "-i", list, "-loop", "1", "-i", mask];
        const chain = [
          `[1:v]fps=${FPS},scale=${SCREEN.w}:${SCREEN.h}:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=${pad},format=rgba[s]`,
          `[2:v]format=gray,scale=${SCREEN.w}:${SCREEN.h}[m]`,
          "[s][m]alphamerge[sm]",
          `[0:v][sm]overlay=${SCREEN.x}:${SCREEN.y}:shortest=0[b0]`,
        ];
        const scale = SCREEN.w / 402;
        shot.taps.forEach((tap, i) => {
          inputs.push("-loop", "1", "-i", ring);
          const at = Math.max(0, timeline.map(snapTap(frames, tap.t)) - 0.05);
          const x = Math.round(SCREEN.x + tap.x * scale - 38);
          const y = Math.round(SCREEN.y + tap.y * scale - 38);
          chain.push(`[${i + 3}:v]format=rgba,fade=in:st=${at.toFixed(3)}:d=0.08:alpha=1,fade=out:st=${(at + 0.3).toFixed(3)}:d=0.35:alpha=1[r${i}]`);
          chain.push(`[b${i}][r${i}]overlay=${x}:${y}:enable='between(t,${at.toFixed(3)},${(at + 0.7).toFixed(3)})'[b${i + 1}]`);
        });
        ffmpeg([...inputs, "-filter_complex", chain.join(";"), "-map", `[b${shot.taps.length}]`, "-t", length.toFixed(3), ...ENCODE, out]);
      }
      lengths.push(length);
    }
    files.push(out);
    console.log(`${scene.id.padEnd(22)} ${lengths.at(-1)!.toFixed(1)} s`);
  }
  await browser.close();

  const chain: string[] = [];
  let offset = 0;
  let previous = "[0:v]";
  for (let i = 1; i < files.length; i += 1) {
    offset += lengths[i - 1] - FADE;
    const label = i === files.length - 1 ? "[out]" : `[v${i}]`;
    chain.push(`${previous}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${label}`);
    previous = label;
  }
  mkdirSync(dirname(tour.out), { recursive: true });
  ffmpeg([...files.flatMap((file) => ["-i", file]), ...(files.length > 1 ? ["-filter_complex", chain.join(";"), "-map", "[out]"] : []),
    ...ENCODE, "-movflags", "+faststart", tour.out]);

  const stampOf = (seconds: number) => {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const pad = (value: number, size = 2) => String(value).padStart(size, "0");
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  const placed: Placed[] = [];
  const srt: string[] = [];
  let at = 0;
  tour.scenes.forEach((scene, i) => {
    const text = scene.on === "card" ? [scene.title ?? "", ...(scene.lines ?? [])].join("\n").replace(/\*\*/g, "") : scene.subtitle ?? "";
    const from = at + (i === 0 ? 0 : FADE / 2);
    const to = at + lengths[i] - (i === tour.scenes.length - 1 ? 0 : FADE / 2);
    srt.push(`${i + 1}\n${stampOf(from)} --> ${stampOf(to)}\n${text}\n`);
    placed.push({ id: scene.id, kind: scene.on, subtitle: text, start: from, end: to });
    at += lengths[i] - FADE;
  });
  writeFileSync(tour.out.replace(/\.mp4$/, ".srt"), srt.join("\n"));
  writeFileSync(join(takeDir, "timeline.json"), JSON.stringify(placed, null, 2));
  const total = lengths.reduce((sum, length) => sum + length, 0) - FADE * (files.length - 1);
  console.log(`video: ${tour.out} (${total.toFixed(1)} s)`);
  return { total, placed };
}
