---
name: full-flow
description: Make a "full flow" board of what was built - every step's screenshot in order, joined by arrows, with numbered red highlight boxes on the controls that matter, a subtitle under each step and a status pill (live, Staging, not live). Use whenever the user asks for the "full flow", "show me the flow", "what did you build" or a visual walkthrough of a feature, and offer it at the end of any feature that spans more than one screen.
---

# Full flow board

A "full flow" is screenshots joined with arrows, with highlights and
subtitles, so a reader sees what was built and what happens at each step.
Every feature that spans screens ends with one.

First run: `cd` into this skill's folder and run `bun install` (Playwright for
`capture.ts` and `render.ts`). The commands below assume the skill sits in
`~/.claude/skills/full-flow`; use its real folder if it is elsewhere.

## What a board shows

- Lanes, top to bottom: each lane is one stage of the flow ("1 · A new seller
  signs up"). A lane's steps are joined left to right. Set `"join": false`
  when the steps are alternatives (two ways in), not a sequence.
- Each step: its number, a short title (what the person does), the screenshot,
  numbered highlight boxes on the controls that matter, a one or two sentence
  subtitle (where it is, what happens, who sees it), and a status pill:
  `live` (on production), `staging`, `not-live`, `local`. Say the truth: a
  step that is not on production is never `live`.
- Extra arrows in `edges` (`from`, `to`, `label`, `dashed`). Dashed means
  "happens in the background" or "not live yet". Arrows that skip a lane run
  down the left margin by themselves, so they never pass behind a card.
- Branches (approve or reject) get their own lane ("Or · they reject").

## Steps

1. Make a folder next to the feature's evidence:
   `docs/evidence/<date>-<feature>-full-flow/` with `shots/` and `flow.json`.
2. Get one screenshot per step. Reuse the sessions' evidence screenshots when
   they show the final code. For a public page, capture it and get highlight
   boxes in one go:
   `bun ~/.claude/skills/full-flow/capture.ts <url> shots/<name>.png --full --boxes 'input[name=email],button[type=submit]'`
   It prints each selector's box as fractions, ready for `highlights`. For a
   signed-in page, use the browser pane (scroll the element into view with
   JavaScript, then a scale-1 screenshot) or the simulator.
3. Read each screenshot before you place boxes. Boxes are `[x, y, w, h]` as
   fractions of the whole image. `crop` (same units) shows only part of an
   image: cut the app sidebar, and anything with personal data (emails,
   phones) a board should not carry.
4. Write `flow.json` (the format is at the top of `render.ts`), then render:
   `bun ~/.claude/skills/full-flow/render.ts docs/evidence/<folder>/flow.json --scale 1.5`
   It writes `full-flow.png` and `full-flow.html` next to the spec.
5. Read the PNG and review it like a screenshot: no arrow behind a card, no
   label on top of a heading, no box on the wrong control, no cut text. Fix
   the spec and render again.
6. Send the PNG with SendUserFile (display render), commit the folder with
   the feature's evidence, and say in the reply which steps are not live.

Width: 1960 fits three 520 px cards per row; 2600 fits four. Keep titles
under about 35 characters so they stay on one line.
