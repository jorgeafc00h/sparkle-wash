// Pure timeline maths for the walkthrough player: no React, no DOM, so it is unit-testable.
// Every step becomes a "beat" holding its slot on the normalized timeline and the choreography
// (delays in seconds from the start of the step) that walkthrough.css reads as custom properties.
import type { Box, WalkStep, Walkthrough } from './types';

export interface Pt { x: number; y: number }
export interface Typed { x: number; y: number; text: string }
/** Camera for the zoom: scale plus translate (in % of the frame) with transform-origin 0 0. */
export interface Cam { s: number; x: number; y: number }

export interface Beat {
  i: number;
  step: WalkStep;
  start: number;        // seconds from the start of the walkthrough (normalized)
  len: number;          // seconds this step stays on screen
  image: string;        // screenshot shown during the step
  prevImage?: string;   // the screenshot this step crossfades from
  cursor?: Pt;          // pointer position (carried over from earlier steps when the step has none)
  from?: Pt;            // where the pointer travels from; undefined when it first appears
  click: boolean;
  kept: Typed[];        // text typed in earlier steps on the same screenshot (stays in its field)
  cam: Cam;
  camFrom: Cam;
  top: boolean;         // caption sits at the top because the action is near the bottom
  d: { move: number; click: number; type: number; cps: number; toast: number; out: number; zoom: number };
}

export interface Timeline { beats: Beat[]; total: number }

export const NO_CAM: Cam = { s: 1, x: 0, y: 0 };
const MAX_ZOOM = 1.45;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Gentle zoom into a box. The fixed point of the scale is the box centre (the transform-origin),
 * nudged only as far as needed to keep the whole box inside the frame. Expressed as
 * translate(p·(1-s)) scale(s) so consecutive zooms on different boxes interpolate without jumps.
 */
export function camFor(b?: Box): Cam {
  if (!b || !(b.w > 0) || !(b.h > 0)) return NO_CAM;
  const s = clamp(Math.min(MAX_ZOOM, 88 / b.w, 88 / b.h), 1, MAX_ZOOM);
  if (s < 1.01) return NO_CAM;
  const axis = (p0: number, size: number) => {
    const lo = (s * (p0 + size) - 100) / (s - 1);
    const hi = (s * p0) / (s - 1);
    return r3(clamp(clamp(p0 + size / 2, lo, hi), 0, 100) * (1 - s));
  };
  return { s: r3(s), x: axis(b.x, b.w), y: axis(b.y, b.h) };
}

/** Where a point of the screenshot lands on screen under a camera (percent). */
export const project = (cam: Cam, v: number, axis: 'x' | 'y') => cam[axis] + cam.s * v;

function captionAtTop(step: WalkStep, cam: Cam): boolean {
  const lows: number[] = [];
  const highs: number[] = [];
  if (step.highlight) { lows.push(step.highlight.y + step.highlight.h); highs.push(step.highlight.y); }
  if (step.cursor) { lows.push(step.cursor.y + 4); highs.push(step.cursor.y); }
  if (step.type) { lows.push(step.type.y + 3); highs.push(step.type.y - 3); }
  if (!lows.length) return false;
  const low = Math.max(...lows.map((y) => project(cam, y, 'y')));
  const high = Math.min(...highs.map((y) => project(cam, y, 'y')));
  return low > 74 && high > 26;
}

export function buildTimeline(w: Walkthrough): Timeline {
  const steps = w.steps ?? [];
  const aspect = w.aspect > 0 ? w.aspect : 16 / 9;
  let t = 0;
  let image = w.image;
  let cursor: Pt | undefined;
  let kept = new Map<string, Typed>();
  let camPrev = NO_CAM;

  const beats = steps.map((step, i): Beat => {
    const next = steps[i + 1];
    const len = Math.max(0.8, next && next.at > step.at ? next.at - step.at : step.dur > 0 ? step.dur : 3);
    let prevImage: string | undefined;
    if (step.image && step.image !== image) {
      prevImage = image;
      image = step.image;
      kept = new Map();
    }
    const keyOf = (p: Pt) => `${p.x},${p.y}`;
    const keptNow = [...kept.values()].filter((k) => !step.type || keyOf(k) !== keyOf(step.type));

    const from = cursor;
    const target = step.cursor ? { x: step.cursor.x, y: step.cursor.y } : cursor;
    const dist = from && target ? Math.hypot(target.x - from.x, (target.y - from.y) / aspect) : 0;
    const moveDur = step.cursor ? (from ? clamp(0.4 + dist * 0.012, 0.4, Math.max(0.4, Math.min(1.1, len * 0.4))) : 0.45) : 0;
    const click = !!step.cursor?.click;
    const clickAt = 0.15 + moveDur + 0.05;
    const typeAt = click ? clickAt + 0.3 : step.cursor ? 0.3 + moveDur : 0.35;
    const n = step.type?.text.length ?? 0;
    const cps = n ? clamp((len * 0.4) / n, 0.025, 0.075) : 0;
    const settled = n ? typeAt + n * cps + 0.25 : click ? clickAt + 0.45 : 0.5;
    const cam = camFor(step.zoom);
    const camFrom = camPrev;
    const last = i === steps.length - 1;

    const beat: Beat = {
      i, step, start: r3(t), len: r3(len), image, prevImage,
      cursor: target, from: step.cursor ? from : target, click,
      kept: keptNow, cam, camFrom, top: captionAtTop(step, cam),
      d: {
        move: r3(moveDur),
        click: r3(clickAt),
        type: r3(typeAt),
        cps: r3(cps),
        toast: r3(Math.max(0.3, Math.min(settled, len - 1.1))),
        out: last ? 9999 : r3(len - 0.3),
        zoom: cam.s === camFrom.s && cam.x === camFrom.x && cam.y === camFrom.y ? 0 : r3(Math.min(cam.s > 1 ? 1.1 : 0.8, len * 0.45)),
      },
    };
    if (step.type) kept.set(keyOf(step.type), step.type);
    cursor = target;
    camPrev = cam;
    t += len;
    return beat;
  });

  return { beats, total: r3(t) };
}
