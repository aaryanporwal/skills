# Skills

Agent skills for showing what was built, in a fixed style an agent does not have to design again.

| Skill | What it makes |
|---|---|
| [`full-flow`](skills/full-flow/SKILL.md) | A board image of a feature's flow: every step's screenshot in order, joined by arrows, with numbered highlight boxes, a subtitle under each step and a status pill. |
| [`full-flow-video-walkthrough`](skills/full-flow-video-walkthrough/SKILL.md) | A short subtitled walkthrough video (MP4 and SRT) from one YAML tour file: iPhone simulator scenes framed as a phone, web scenes at 1440x900, visible taps and clicks, title cards, and an optional voice-over made locally with Kokoro. |

## Install

```bash
npx skills add aaryanporwal/skills
```

Then run `bun install` once in each skill's folder. `full-flow` needs Bun. `full-flow-video-walkthrough` also
needs ffmpeg, and for phone scenes Maestro, Java (for example Homebrew `openjdk@21`) and the Xcode iOS simulator.
Its self-test, `examples/demo/tour.yaml`, needs only a booted iPhone 17 Pro simulator. The voice-over needs `uv`
and Apple silicon: it runs Kokoro-82M and Whisper on the Mac, with no paid service.

## License

MIT
