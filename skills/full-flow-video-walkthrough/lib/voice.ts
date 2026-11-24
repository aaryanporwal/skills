/** Voice-over, made on this Mac: Kokoro-82M speaks each scene's line, Whisper checks the words. See voice.py. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Scene, Tour } from "./spec";

export type Clip = { id: string; file: string; seconds: number; text: string; heard: string };

/** What a scene says out loud: `say`, else its subtitle; a card says its title and lines. `say: ""` is silent. */
export function spokenText(scene: Scene) {
  if (scene.say !== undefined) return scene.say;
  if (scene.on === "card") return [scene.title ?? "", ...(scene.lines ?? [])].map((part) => part.replace(/\*\*/g, "").trim().replace(/([^.!?])$/, "$1.")).join(" ");
  return scene.subtitle ?? "";
}

/** The text Kokoro reads: the spoken text with the tour's pronunciations swapped in, whole words only. */
const forSpeech = (text: string, pronounce: Record<string, string>) =>
  Object.entries(pronounce).reduce((out, [word, spoken]) => out.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), spoken), text);

const NUMBERS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(" ");
const normal = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

/** Makes any missing clips (cached by text, speaker and speed), measures every clip, and warns on misheard words. */
export function voices(tour: Tour): Map<string, Clip> {
  const clips = new Map<string, Clip>();
  if (!tour.voice) return clips;
  const { speaker, speed, pronounce } = tour.voice;
  const dir = join(tour.work, "voice");
  mkdirSync(dir, { recursive: true });
  const lines = tour.scenes
    .map((scene) => ({ scene, text: spokenText(scene).trim() }))
    .filter((item) => item.text)
    .map(({ scene, text }) => {
      const speech = forSpeech(text, pronounce);
      const key = createHash("sha1").update(JSON.stringify([speech, speaker, speed])).digest("hex").slice(0, 12);
      return { id: scene.id, text, speech, out: join(dir, `${scene.id}-${key}.wav`) };
    });
  if (!lines.length) return clips;
  const jobFile = join(dir, "job.json");
  writeFileSync(jobFile, JSON.stringify({ speaker, speed, lines: lines.map(({ id, speech, out }) => ({ id, text: speech, out })) }));
  console.log(`voice: ${lines.length} lines, Kokoro ${speaker} at ${speed} (the first run downloads the models)`);
  const run = spawnSync("uv", ["run", "-q", join(import.meta.dir, "voice.py"), jobFile], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (run.status !== 0) throw new Error(`voice.py failed:\n${run.stderr.split("\n").filter((line) => !/warn/i.test(line)).slice(-15).join("\n")}`);
  for (const row of run.stdout.split("\n").filter((line) => line.startsWith("{"))) {
    const { id, out, seconds, heard } = JSON.parse(row) as { id: string; out: string; seconds: number; heard: string };
    const line = lines.find((item) => item.id === id)!;
    clips.set(id, { id, file: out, seconds, text: line.text, heard });
    // Compare what Kokoro was asked to say with what Whisper heard, letters only, numbers as words ("8" is "eight").
    const got = normal(heard.replace(/\d+/g, (n) => ` ${NUMBERS[Number(n)] ?? n} `)).join("");
    const missed = normal(line.speech).filter((word) => !got.includes(word));
    const mark = missed.length ? `CHECK (heard: "${heard}")` : "words ok";
    console.log(`  ${id.padEnd(22)} ${seconds.toFixed(1).padStart(5)} s  ${mark}`);
  }
  return clips;
}
