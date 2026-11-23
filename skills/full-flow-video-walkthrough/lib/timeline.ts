/**
 * One rule for both phone and web: a recording is a list of frames, each written when the screen changed (the
 * simulator's recordVideo and Chrome's screencast both work that way). A scene keeps its window of frames, shortens
 * every still stretch to MAX_IDLE + LEAD, and freezes on `hold`. So a slow server or a slow driver never shows, and
 * the same tour gives the same video.
 */
import { LEAD, MAX_IDLE } from "./style";

export type Frame = { t: number; file: string }; // t: wall-clock seconds
export type Hold = { t: number; seconds: number };
export type Piece = { file: string; seconds: number };

export type Plan = { pieces: Piece[]; length: number; map: (t: number) => number };

export function plan(all: Frame[], start: number, end: number, holds: Hold[]): Plan {
  const frames = all.filter((frame) => Number.isFinite(frame.t)).sort((a, b) => a.t - b.t);
  const before = frames.filter((frame) => frame.t <= start).at(-1) ?? frames.find((frame) => frame.t > start);
  if (!before) throw new Error("no frames in this recording");
  const shown = [before, ...frames.filter((frame) => frame.t > start && frame.t < end && frame !== before)];
  const spans = shown.map((frame, index) => {
    const a = Math.max(frame.t, start);
    const b = index + 1 < shown.length ? shown[index + 1].t : end;
    const last = index + 1 === shown.length;
    const natural = Math.max(0, b - a);
    // A still stretch keeps its first MAX_IDLE and its last LEAD; the last span (the result) keeps up to 2 x MAX_IDLE.
    const cap = last ? MAX_IDLE * 2 : MAX_IDLE + LEAD;
    const kept = Math.min(natural, cap);
    const extra = holds.filter((hold) => hold.t >= a && (hold.t < b || (last && hold.t <= b))).reduce((sum, hold) => sum + hold.seconds, 0);
    return { file: frame.file, a, b, natural, kept, extra, last };
  });
  const pieces = spans.map((span) => ({ file: span.file, seconds: Math.max(0.001, span.kept + span.extra) }));
  const length = pieces.reduce((sum, piece) => sum + piece.seconds, 0);

  const map = (t: number) => {
    let out = 0;
    for (const span of spans) {
      if (t < span.b || span.last) {
        const off = t - span.a;
        let local: number;
        if (span.kept >= span.natural) local = Math.max(0, Math.min(off, span.natural));
        else if (span.last) local = Math.max(0, Math.min(off, span.kept));
        else if (off <= MAX_IDLE) local = Math.max(0, off);
        else if (off >= span.natural - LEAD) local = MAX_IDLE + (off - (span.natural - LEAD));
        else local = MAX_IDLE;
        const held = holds.filter((hold) => hold.t >= span.a && hold.t <= t).reduce((sum, hold) => sum + hold.seconds, 0);
        return out + local + held;
      }
      out += span.kept + span.extra;
    }
    return out;
  };
  return { pieces, length, map };
}

/** A logged tap time can be a little late or early; the screen's first change after it is the truth. */
export function snapTap(frames: Frame[], t: number) {
  const next = frames.find((frame) => frame.t > t - 0.15);
  if (next && next.t - t < 1.0) return Math.min(t, next.t - 0.06);
  return t;
}

export function concatList(pieces: Piece[]) {
  const lines: string[] = [];
  for (const piece of pieces) lines.push(`file '${piece.file}'`, `duration ${piece.seconds.toFixed(4)}`);
  lines.push(`file '${pieces.at(-1)!.file}'`);
  return `${lines.join("\n")}\n`;
}
