/** Runs the whole tour once, in order, and writes take.json: every scene's frames, window, taps and holds. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { bootedDevice, clearLook, extractFrames, runScenes, runSetup, setLook, startRecording, stopRecording, type Tap } from "./phone";
import type { Scene, Tour } from "./spec";
import type { Hold } from "./timeline";
import { WebRunner } from "./web";

export type Shot = { id: string; surface: "phone" | "web"; frames: string; start: number; end: number; holds: Hold[]; taps: Tap[] };
export type Take = { tour: string; made: string; shots: Shot[] };

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");

export async function record(tour: Tour) {
  const dir = join(tour.work, `take-${stamp()}`);
  mkdirSync(dir, { recursive: true });
  const shots: Shot[] = [];
  const scenes = tour.scenes.filter((scene) => scene.on !== "card");
  let web: WebRunner | undefined;
  const udid = tour.phone ? bootedDevice(tour.phone.device)?.udid : undefined;
  if (tour.phone && !udid) throw new Error("no booted simulator: boot one (or name it in phone.device) first");

  try {
    let index = 0;
    let phoneTake = 0;
    while (index < scenes.length) {
      const scene = scenes[index];
      if (scene.on === "web") {
        if (!web) {
          web = new WebRunner(tour, join(dir, "web"));
          await web.open();
        }
        console.log(`web   ${scene.id}`);
        const shot = await web.scene(scene);
        shots.push({ ...shot, surface: "web", taps: [] });
        index += 1;
        continue;
      }
      // A run of phone scenes is one screen recording; a scene with setup starts a new Maestro flow inside it.
      const group: Scene[] = [];
      while (index < scenes.length && scenes[index].on === "phone") group.push(scenes[index++]);
      const take = join(dir, `phone-${phoneTake++}`);
      mkdirSync(take, { recursive: true });
      setLook(udid!, tour.phone!.statusBar);
      if (group[0].setup) runSetup(tour, udid!, group[0].setup);
      const video = join(take, "screen.mp4");
      const { child, started } = await startRecording(udid!, video);
      try {
        let at = 0;
        let flow = 0;
        while (at < group.length) {
          const batch = [group[at++]];
          while (at < group.length && !group[at].setup) batch.push(group[at++]);
          if (flow > 0 && batch[0].setup) runSetup(tour, udid!, batch[0].setup);
          console.log(`phone ${batch.map((item) => item.id).join(", ")}`);
          const made = runScenes(tour, udid!, batch, join(take, `flow-${flow++}`));
          for (const shot of made) shots.push({ ...shot, surface: "phone", frames: join(take, "frames") });
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } finally {
        await stopRecording(child);
      }
      extractFrames(video, started, join(take, "frames"));
    }
  } finally {
    await web?.close();
    if (udid) clearLook(udid, tour.phone!.statusBar);
  }

  const take: Take = { tour: tour.file, made: new Date().toISOString(), shots };
  writeFileSync(join(dir, "take.json"), JSON.stringify(take, null, 2));
  writeFileSync(join(tour.work, "latest"), dir);
  console.log(`take: ${dir}`);
  return dir;
}
