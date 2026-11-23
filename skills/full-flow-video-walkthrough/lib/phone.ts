/**
 * Phone scenes: the iOS simulator records the screen (`simctl io recordVideo`) while Maestro runs the taps. Maestro's
 * own log says where and when each tap landed, so rings and scene windows need no guessing.
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import YAML from "yaml";

import { asTarget, type Scene, type Step, type Tour } from "./spec";
import type { Frame, Hold } from "./timeline";

export type Tap = { t: number; x: number; y: number };
export type PhoneShot = { id: string; start: number; end: number; taps: Tap[]; holds: Hold[] };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function javaHome() {
  const probe = spawnSync("java", ["-version"], { encoding: "utf8" });
  if (probe.status === 0 && !/Unable to locate a Java Runtime/.test(probe.stderr)) return process.env.JAVA_HOME;
  for (const home of ["/opt/homebrew/opt/openjdk@21", "/opt/homebrew/opt/openjdk@17", "/opt/homebrew/opt/openjdk"]) {
    if (existsSync(join(home, "bin/java"))) return home;
  }
  return undefined;
}

export function bootedDevice(wanted?: string) {
  const list = JSON.parse(execFileSync("xcrun", ["simctl", "list", "devices", "-j"], { encoding: "utf8" })) as {
    devices: Record<string, { udid: string; name: string; state: string }[]>;
  };
  const all = Object.values(list.devices).flat();
  const booted = all.filter((device) => device.state === "Booted");
  if (wanted) return all.find((device) => device.udid === wanted || device.name === wanted && device.state === "Booted");
  return booted[0];
}

const simctl = (...args: string[]) => spawnSync("xcrun", ["simctl", ...args], { encoding: "utf8" });

export function setLook(udid: string, statusBar: boolean) {
  simctl("ui", udid, "appearance", "light");
  if (statusBar) {
    simctl("status_bar", udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100",
      "--cellularBars", "4", "--wifiBars", "3");
  }
}

export function clearLook(udid: string, statusBar: boolean) {
  if (statusBar) simctl("status_bar", udid, "clear");
}

/** Starts the screen recording and resolves once the simulator says it is recording, with the wall-clock time. */
export async function startRecording(udid: string, file: string): Promise<{ child: ChildProcess; started: number }> {
  const child = spawn("xcrun", ["simctl", "io", udid, "recordVideo", "--codec=h264", "--force", file], { stdio: ["ignore", "pipe", "pipe"] });
  const started = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("recordVideo did not start within 20 s")), 20000);
    const look = (chunk: Buffer) => {
      if (/Recording started/i.test(chunk.toString())) {
        clearTimeout(timer);
        resolve(Date.now() / 1000);
      }
    };
    child.stdout!.on("data", look);
    child.stderr!.on("data", look);
    child.on("exit", () => reject(new Error("recordVideo exited before it started")));
  });
  return { child, started };
}

export async function stopRecording(child: ChildProcess) {
  const done = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  child.kill("SIGINT");
  await Promise.race([done, wait(20000)]);
}

/** The recording's frames as images, each with its wall-clock time. */
export function extractFrames(video: string, started: number, dir: string): Frame[] {
  mkdirSync(dir, { recursive: true });
  // One line per frame; a frame with side data prints a trailing comma ("0.000000,"), so parse the leading number.
  const times = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "frame=best_effort_timestamp_time",
    "-of", "csv=p=0", video], { encoding: "utf8" }).trim().split("\n").map((line) => Number.parseFloat(line));
  if (times.some((time) => !Number.isFinite(time))) throw new Error("a frame in the recording has no timestamp");
  // Two frames can share a timestamp; number them instead, and take the times from ffprobe's list above.
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "fatal", "-y", "-i", video, "-vf", "setpts=N/1000/TB", "-fps_mode", "passthrough",
    "-enc_time_base", "1/1000", "-q:v", "2", join(dir, "%06d.jpg")]);
  const written = execFileSync("ls", [dir], { encoding: "utf8" }).split("\n").filter((name) => name.endsWith(".jpg")).length;
  if (written !== times.length) throw new Error(`frame count mismatch: ${written} images, ${times.length} timestamps`);
  const frames = times.map((pts, index) => ({ t: started + pts, file: join(dir, `${String(index + 1).padStart(6, "0")}.jpg`) }))
    .filter((frame) => existsSync(frame.file));
  writeFileSync(join(dir, "frames.json"), JSON.stringify(frames));
  return frames;
}

export function runSetup(tour: Tour, udid: string, setup: Step[]) {
  for (const step of setup) {
    if (step.launch !== undefined) {
      const launch = (step.launch ?? {}) as { args?: string[]; terminate?: boolean; fresh?: boolean };
      if (launch.terminate !== false) simctl("terminate", udid, tour.phone!.appId);
      if (launch.fresh) {
        // Forget the screen the app last showed, so the scene starts where the tour expects.
        const data = simctl("get_app_container", udid, tour.phone!.appId, "data").stdout.trim();
        if (data && data !== "(null)") spawnSync("rm", ["-rf", join(data, "Library", "Saved Application State")]);
      }
      const result = simctl("launch", udid, tour.phone!.appId, ...(launch.args ?? []));
      if (result.status !== 0) throw new Error(`launch failed: ${result.stderr}`);
      execFileSync("sleep", ["2"]);
    } else if (step.open) {
      const result = simctl("openurl", udid, String(step.open));
      if (result.status !== 0) throw new Error(`open ${step.open} failed: ${result.stderr}`);
      execFileSync("sleep", ["2"]);
    } else if (step.shell) {
      execFileSync("/bin/bash", ["-c", String(step.shell)], { cwd: tour.dir, stdio: "inherit" });
    } else if (step.hold) {
      execFileSync("sleep", [String(step.hold)]);
    }
  }
}

const regex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function selector(value: unknown) {
  const target = asTarget(value);
  if (target.point) return { point: `${target.point[0]},${target.point[1]}` };
  const out: Record<string, unknown> = target.id ? { id: target.id } : { text: regex(target.text ?? "") };
  if (target.index !== undefined) out.index = target.index;
  return out;
}

/** One Maestro command per on-camera step (`hold` is not a command: the cut freezes there). */
function command(step: Step) {
  if (step.tap !== undefined) return { tapOn: selector(step.tap) };
  if (step.wait !== undefined) {
    const value = step.wait as string | { text?: string; id?: string; timeout?: number };
    const target = typeof value === "string" ? { text: value } : value;
    return { extendedWaitUntil: { visible: target.id ? { id: target.id } : { text: regex(target.text ?? "") }, timeout: (typeof value === "object" && value.timeout) || 20000 } };
  }
  if (step.swipe !== undefined) {
    const swipe = step.swipe as { from: [number, number]; to: [number, number] };
    return { swipe: { start: `${swipe.from[0]},${swipe.from[1]}`, end: `${swipe.to[0]},${swipe.to[1]}`, duration: 400 } };
  }
  return undefined;
}

type Logged = { kind: string; start: number; end: number };

/**
 * Runs the on-camera steps of these scenes as one Maestro flow and returns each scene's window and taps.
 * Maestro's start-up (about 20 s) happens before the first command, so it never reaches the video.
 */
export function runScenes(tour: Tour, udid: string, scenes: Scene[], dir: string): PhoneShot[] {
  mkdirSync(dir, { recursive: true });
  const commands: unknown[] = [];
  const owners: { scene: number; step: Step }[] = [];
  scenes.forEach((scene, index) => {
    for (const step of scene.steps ?? []) {
      const made = command(step);
      if (made) {
        commands.push(made);
        owners.push({ scene: index, step });
      }
    }
  });
  const flow = join(dir, "flow.yaml");
  writeFileSync(flow, `appId: ${tour.phone!.appId}\n---\n${YAML.stringify(commands)}`);
  const debug = join(dir, "debug");
  const java = javaHome();
  const env = { ...process.env, ...(java ? { JAVA_HOME: java, PATH: `${java}/bin:${process.env.PATH}` } : {}) };
  const run = spawnSync("maestro", ["--device", udid, "test", flow, "--debug-output", debug, "--flatten-debug-output"],
    { encoding: "utf8", env, timeout: 600000 });
  writeFileSync(join(dir, "maestro.out"), `${run.stdout}\n${run.stderr}`);
  if (run.status !== 0) throw new Error(`Maestro failed (see ${dir}/maestro.out):\n${run.stdout.split("\n").slice(-12).join("\n")}`);

  const flowName = "flow";
  const json = JSON.parse(readFileSync(join(debug, flowName, "commands.json"), "utf8")) as {
    command: Record<string, unknown>; metadata: { timestamp: number; duration: number; sequenceNumber?: number };
  }[];
  const logged: Logged[] = json
    .filter((entry) => !("defineVariablesCommand" in entry.command) && !("applyConfigurationCommand" in entry.command))
    .map((entry) => ({ kind: Object.keys(entry.command)[0], start: entry.metadata.timestamp / 1000, end: (entry.metadata.timestamp + entry.metadata.duration) / 1000 }));
  if (logged.length !== owners.length) throw new Error(`Maestro ran ${logged.length} commands, expected ${owners.length}`);

  // "HH:MM:SS.mmm ... Try tapping at (x, y)": local time on the day of the first command.
  const day = new Date(logged[0].start * 1000);
  const log = readFileSync(join(debug, flowName, "logs", "maestro.log"), "utf8");
  const taps = [...log.matchAll(/^(\d\d):(\d\d):(\d\d)\.(\d{3}).*Try tapping at \((\d+), (\d+)\)/gm)].map((match) => {
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), +match[1], +match[2], +match[3], +match[4]);
    return { t: at.getTime() / 1000, x: +match[5], y: +match[6] };
  });

  return scenes.map((scene, index) => {
    const mine = owners.map((owner, i) => ({ owner, log: logged[i] })).filter((item) => item.owner.scene === index);
    const first = mine[0];
    const last = mine.at(-1)!;
    const start = first.owner.step.wait !== undefined ? first.log.end - 0.2 : first.log.start - 1.0;
    const nextFirst = owners.findIndex((owner) => owner.scene === index + 1);
    const ceiling = nextFirst >= 0 ? logged[nextFirst].start - 0.2 : Infinity;
    const end = Math.min(last.log.end + 1.1, ceiling);
    const shotTaps = mine.filter((item) => item.owner.step.tap !== undefined).map((item) => {
      const hit = taps.find((tap) => tap.t >= item.log.start - 0.05 && tap.t <= item.log.end + 0.05);
      const target = asTarget(item.owner.step.tap);
      if (hit) return hit;
      if (target.point) return { t: item.log.start + 0.3, x: target.point[0], y: target.point[1] };
      throw new Error(`no tap position in Maestro's log for ${JSON.stringify(item.owner.step.tap)}`);
    });
    // A hold freezes the screen right after the step before it.
    const holds: Hold[] = [];
    let previousEnd = start;
    let i = 0;
    for (const step of scene.steps ?? []) {
      if (step.hold) holds.push({ t: previousEnd, seconds: Number(step.hold) });
      else if (command(step)) previousEnd = mine[i++]?.log.end ?? previousEnd;
    }
    return { id: scene.id, start, end, taps: shotTaps, holds };
  });
}
