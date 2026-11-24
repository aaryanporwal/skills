#!/usr/bin/env bun
/**
 * Full flow video walkthrough: one tour file in, one subtitled MP4 out, always in the same style.
 *
 *   bun ~/.claude/skills/full-flow-video-walkthrough/walkthrough.ts check  <tour.yaml>
 *   bun ~/.claude/skills/full-flow-video-walkthrough/walkthrough.ts record <tour.yaml>
 *   bun ~/.claude/skills/full-flow-video-walkthrough/walkthrough.ts voice  <tour.yaml>   (make and check the voice lines only)
 *   bun ~/.claude/skills/full-flow-video-walkthrough/walkthrough.ts cut    <tour.yaml> [--take <dir>]
 *   bun ~/.claude/skills/full-flow-video-walkthrough/walkthrough.ts review <tour.yaml> [--take <dir>]
 *   bun ~/.claude/skills/full-flow-video-walkthrough/walkthrough.ts all    <tour.yaml>   (check, record, cut, review)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { cut } from "./lib/cut";
import { bootedDevice, javaHome } from "./lib/phone";
import { record } from "./lib/record";
import { review } from "./lib/review";
import { loadTour, type Tour } from "./lib/spec";
import { voices } from "./lib/voice";

const [command, file] = process.argv.slice(2);
const takeFlag = process.argv.indexOf("--take");
if (!command || !file || !["check", "record", "voice", "cut", "review", "all"].includes(command)) {
  console.error("usage: walkthrough.ts check|record|voice|cut|review|all <tour.yaml> [--take <dir>]");
  process.exit(2);
}

const has = (tool: string, args = ["-version"]) => spawnSync(tool, args, { encoding: "utf8" }).status === 0;

async function check(tour: Tour, problems: { level: string; where: string; text: string }[]) {
  const all = [...problems];
  if (!has("ffmpeg") || !has("ffprobe")) all.push({ level: "error", where: "tools", text: "ffmpeg and ffprobe are needed (brew install ffmpeg)" });
  if (tour.voice && !has("uv", ["--version"])) all.push({ level: "error", where: "tools", text: "voice needs uv (brew install uv)" });
  if (tour.voice && process.arch !== "arm64") all.push({ level: "error", where: "tools", text: "voice checks words with mlx-whisper, which needs Apple silicon" });
  if (tour.scenes.some((scene) => scene.on === "phone")) {
    if (!has("maestro", ["--version"]) && !existsSync("/opt/homebrew/bin/maestro")) all.push({ level: "error", where: "tools", text: "Maestro is needed for phone scenes (brew install maestro)" });
    if (!javaHome() && !has("java")) all.push({ level: "error", where: "tools", text: "Maestro needs Java: brew install openjdk@21" });
    const device = bootedDevice(tour.phone?.device);
    if (!device) all.push({ level: "error", where: "phone", text: "no booted simulator; boot an iPhone 17 Pro (402 x 874 points) first" });
    else {
      if (!/iPhone 17 Pro$/.test(device.name)) all.push({ level: "warn", where: "phone", text: `${device.name}: the phone frame is drawn for an iPhone 17 Pro; other sizes stretch` });
      const app = spawnSync("xcrun", ["simctl", "get_app_container", device.udid, tour.phone!.appId], { encoding: "utf8" });
      if (app.status !== 0) all.push({ level: "error", where: "phone", text: `${tour.phone!.appId} is not installed on ${device.name}` });
    }
  }
  if (tour.scenes.some((scene) => scene.on === "web")) {
    const url = tour.web!.url;
    if (!url.startsWith("file:")) {
      const answer = await fetch(url, { redirect: "manual" }).catch(() => undefined);
      if (!answer || answer.status >= 500) all.push({ level: "error", where: "web", text: `${url} does not answer; start the server first` });
    }
    if (tour.web!.cookies) {
      if (!existsSync(tour.web!.cookies)) all.push({ level: "error", where: "web", text: `cookie file ${tour.web!.cookies} is missing` });
      else if ((statSync(tour.web!.cookies).mode & 0o077) !== 0) all.push({ level: "warn", where: "web", text: "the cookie file is readable by others: chmod 600 it" });
    }
  }
  for (const problem of all) console.log(`${problem.level === "error" ? "ERROR" : "warn "} ${problem.where}: ${problem.text}`);
  const errors = all.filter((problem) => problem.level === "error").length;
  console.log(errors ? `${errors} error(s): fix the tour or the machine first` : `ok: ${tour.scenes.length} scenes, video -> ${tour.out}`);
  return errors === 0;
}

const { tour, problems } = loadTour(file);
const takeDir = () => {
  if (takeFlag > 0) return process.argv[takeFlag + 1];
  const latest = join(tour.work, "latest");
  if (!existsSync(latest)) throw new Error("no take yet: run record first");
  return readFileSync(latest, "utf8").trim();
};

if (command === "check") process.exit((await check(tour, problems)) ? 0 : 1);
if (command === "record") {
  if (!(await check(tour, problems))) process.exit(1);
  await record(tour);
}
if (command === "voice") voices(tour);
if (command === "cut") await cut(tour, takeDir());
if (command === "review") review(tour, takeDir());
if (command === "all") {
  if (!(await check(tour, problems))) process.exit(1);
  const dir = await record(tour);
  await cut(tour, dir);
  review(tour, dir);
}
