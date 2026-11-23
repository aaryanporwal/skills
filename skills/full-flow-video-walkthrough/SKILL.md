---
name: full-flow-video-walkthrough
description: Make a short subtitled walkthrough video of a feature (iPhone simulator scenes framed as a phone, web scenes at 1440x900, visible taps and clicks, one subtitle per step, title cards) from one YAML tour file, always in the same style. Use when asked for a walkthrough video, product tour, demo video, "full flow video" or a video to send someone about what was built; offer it after a feature that spans several screens.
---

# Full flow video walkthrough

One tour file in, one MP4 (H.264, 1440x900, 30 fps) and its SRT out. The look, layout, timing and encoding are
fixed in `lib/style.ts`, so every video matches and nothing is designed from scratch. You write only the tour.

## The style (fixed, do not restyle per video)

- Opens with a card: the feature's name and one line per audience. Ends with a card: what happens next.
- Phone scenes: the simulator screen in a phone frame on a plain paper background, the subtitle to its right
  under a small label ("Example app · business owner"). An orange ring shows each tap.
- Web scenes: the page at 1440x900, a drawn cursor that moves to each control, a ring on each click, and the
  subtitle in a dark bar at the foot, under the same kind of label.
- One subtitle per scene: plain words, 12 at most, what is done and why. No en or em dashes, no internal terms.
- Still stretches are cut short and slow servers never show (see `lib/timeline.ts`); each scene stays up long enough
  to read its subtitle; scenes cross-fade in 0.4 s. Aim for 60 to 100 s, never over 2 minutes.

## Steps

1. Map the real screens and the shortest path through the feature: about 8 to 12 scenes. Skip what is not built.
2. Get the app running with fictional data only (a local stack, never production; never put demo data on
   Staging). Phone: a Debug build installed on a booted **iPhone 17 Pro** simulator (the frame is drawn for its
   402 x 874 points; reuse a booted one). Web: the dev server, plus a signed-in session in a mode-600 cookie file
   (`{"COOKIE_NAME": "value"}`) or a Playwright storage state. Never print a cookie or token; move it from the
   browser pane to the file without it passing through the chat, and delete the file afterwards.
3. Write `tour.yaml` next to the feature's evidence (format below; `examples/` has complete tours).
4. `bun ~/.claude/skills/full-flow-video-walkthrough/walkthrough.ts check <tour.yaml>` until it says ok.
5. `bun ~/.claude/skills/full-flow-video-walkthrough/walkthrough.ts all <tour.yaml>` records every scene in order,
   cuts the video and makes contact sheets. Changing only subtitles or cards needs `cut` then `review`, not a new
   recording. A changed step needs `record` again (state moves on in the app, so reset the fixture data first).
6. Read every sheet `review` prints (three frames per scene: start, middle, end). Check the right screen, a
   readable subtitle that covers no control, no dev overlay, no error, no real personal data. Fix and re-run.
7. Send the MP4 with SendUserFile. Report its path, length, each scene's subtitle, and what was real versus
   staged (for example a file uploaded off camera with a script).

First run on a new machine: `cd ~/.claude/skills/full-flow-video-walkthrough && bun install`, then run the
self-test `examples/demo/tour.yaml` (needs only a booted iPhone 17 Pro). Tools: ffmpeg, Maestro (phone), Java for
Maestro (Homebrew `openjdk@21` is found by itself), Playwright's Chromium (installed with the package).

## Tour format

```yaml
title: Merchant KYC            # for logs
brand: Example                 # small mark above card titles; leave out for none
out: kyc-tour.mp4              # relative to this file; the .srt lands beside it
phone:
  appId: com.example.app       # installed on the booted simulator
  label: Example app · owner   # default label for phone scenes
web:
  url: http://localhost:3000   # or a local .html path
  cookies: ~/.cache/x/session.json
  label: Example HQ · staff
  hide: ["#dev-banner"]        # extra CSS to hide; Next.js's dev badge is always hidden
intro: { title: Merchant KYC, lines: ["**Owners** upload ...", "**Staff** check ..."] }
outro: { title: What happens next, lines: ["..."] }
scenes:
  - id: si-welcome             # unique
    on: phone                  # phone | web | card
    subtitle: Mia just signed up. The app welcomes her.
    label: Example app · owner # optional, overrides the default
    setup:                     # off camera, before the scene
      - launch: { args: ["-someFlag", "value"], fresh: true }   # phone: terminate, forget the last screen, launch
      - open: "myapp://path"   # phone: open a deep link
      - shell: ./seed.sh       # any command, run in this file's folder
    steps:                     # on camera
      - wait: Welcome          # phone: text (or { id: x }); web: text, { url: regex }, { selector }, { gone: text }
      - tap: Continue          # phone: text, { id }, { point: [x, y] } in points, { text, index }
      - hold: 1.5              # freeze here for 1.5 s more
```

Web steps: `goto: /path`, `click: <target>` (add `popup: true` when it opens a new tab; it must be the scene's
last step and the next scene runs in that tab; a later `close: true` in setup returns to the first tab),
`hover`, `fill: { label|selector: ..., value: ... }` (sets the value in one go: never type on camera), `wait`,
`scroll: 400` or `scroll: <target>`, `reload: true`, `hold`, `shell`. A web target is a text string or
`{ role: link, name: Review }`, `{ selector: "#id" }`, `{ label: Email }`, `{ text: X, exact: false }`, with
`in: "<css>"` and `inText: "<text>"` to search inside one container, and `index`. Phone steps: `tap`, `wait`,
`swipe: { from: [x, y], to: [x, y] }`, `hold`; phone setup: `launch`, `open`, `shell`, `hold`.

`examples/demo/tour.yaml` is a runnable self-test. `examples/reference/tour.yaml` shows every kind of step in a
real-shaped tour (app upload, web review in a second tab, accept, send back, the owner's result).

## Traps

- A tap's text is matched by Maestro as a regular expression on the whole label; the tool escapes it. Use
  `{ point: [x, y] }` for an icon with no label.
- Long loads and Maestro's 20 s start-up are cut out by themselves; a spinner that moves stays in (it is honest).
- `record` runs everything once, in order. Data the app shows must be in the state the first scene needs.
- Apps reopen on their last screen. Start a phone scene with `launch: { fresh: true }`, a deep link (`open`), or a
  first `wait` for the screen you expect; the first frame of each scene in the review shows if it went wrong.
- The work folder (default `~/.cache/full-flow-video/<tour name>/take-*`) holds frames; `cut --take <dir>` re-cuts
  an older take.
