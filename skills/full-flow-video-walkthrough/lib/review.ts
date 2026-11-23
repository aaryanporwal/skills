/**
 * Contact sheets for the agent to look at (three frames per scene: just after it starts, the middle, just before it
 * ends) plus the rule checks. Read every sheet before sending the video.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Placed } from "./cut";
import { words, type Tour } from "./spec";

const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

export function review(tour: Tour, takeDir: string) {
  const placed = JSON.parse(readFileSync(join(takeDir, "timeline.json"), "utf8")) as Placed[];
  const dir = join(takeDir, "review");
  mkdirSync(dir, { recursive: true });
  const problems: string[] = [];
  const total = placed.at(-1)!.end;
  if (total > 120) problems.push(`ERROR: ${total.toFixed(1)} s is over the 2 minute limit`);
  else if (total < 45 || total > 100) problems.push(`warn: ${total.toFixed(1)} s; aim for 60 to 100 s`);

  const rows: string[] = [];
  for (const scene of placed) {
    const seconds = scene.end - scene.start;
    if (scene.kind !== "card" && seconds < 3) problems.push(`ERROR: ${scene.id} shows for ${seconds.toFixed(1)} s; a subtitle needs 3 s`);
    if (scene.kind !== "card" && words(scene.subtitle) > 12) problems.push(`warn: ${scene.id} subtitle has ${words(scene.subtitle)} words`);
    const times = [scene.start + 0.3, (scene.start + scene.end) / 2, scene.end - 0.3];
    const tiles = times.map((t, i) => {
      const file = join(dir, `${scene.id}-${i}.png`);
      ffmpeg(["-ss", t.toFixed(2), "-i", tour.out, "-frames:v", "1", "-vf", "scale=480:-1", file]);
      return file;
    });
    const row = join(dir, `row-${scene.id}.png`);
    ffmpeg([...tiles.flatMap((file) => ["-i", file]), "-filter_complex", "hstack=inputs=3", row]);
    rows.push(row);
  }
  const sheets: string[] = [];
  for (let i = 0; i < rows.length; i += 4) {
    const group = rows.slice(i, i + 4);
    const sheet = join(dir, `sheet-${i / 4 + 1}.png`);
    ffmpeg([...group.flatMap((file) => ["-i", file]), "-filter_complex", group.length > 1 ? `vstack=inputs=${group.length}` : "null", sheet]);
    sheets.push(sheet);
  }
  console.log(`length ${total.toFixed(1)} s, ${placed.length} scenes`);
  for (const scene of placed) console.log(`  ${(scene.end - scene.start).toFixed(1).padStart(5)} s  ${scene.id.padEnd(22)} ${scene.subtitle.split("\n")[0]}`);
  for (const problem of problems) console.log(problem);
  console.log(`sheets (rows top to bottom are scenes in order; read each):\n${sheets.join("\n")}`);
  return { sheets, problems };
}
