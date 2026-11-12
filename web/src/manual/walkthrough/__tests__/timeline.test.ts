import { describe, expect, it } from 'vitest';
import { buildTimeline, camFor, NO_CAM, project } from '../timeline';
import type { Walkthrough } from '../types';

const base: Walkthrough = {
  id: 't', title: 'T', image: '/a.webp', aspect: 16 / 9,
  steps: [
    { at: 0, dur: 4, caption: 'uno', cursor: { x: 10, y: 10 } },
    { at: 4, dur: 3, caption: 'dos', cursor: { x: 60, y: 50, click: true }, type: { x: 30, y: 40, text: 'ABC' } },
    { at: 7, dur: 3, caption: 'tres', highlight: { x: 10, y: 80, w: 20, h: 12 } },
    { at: 10, dur: 5, caption: 'cuatro', image: '/b.webp', toast: 'Listo' },
  ],
};

describe('buildTimeline', () => {
  it('slots steps on the timeline from at/dur', () => {
    const { beats, total } = buildTimeline(base);
    expect(beats.map((b) => [b.start, b.len])).toEqual([[0, 4], [4, 3], [7, 3], [10, 5]]);
    expect(total).toBe(15);
  });

  it('falls back to dur when at values do not increase', () => {
    const { beats, total } = buildTimeline({ ...base, steps: base.steps.map((s) => ({ ...s, at: 0 })) });
    expect(beats.map((b) => b.start)).toEqual([0, 4, 7, 10]);
    expect(total).toBe(15);
  });

  it('carries the pointer, typed text and image between steps', () => {
    const { beats } = buildTimeline(base);
    expect(beats[0].from).toBeUndefined(); // first appearance fades in
    expect(beats[1].from).toEqual({ x: 10, y: 10 });
    expect(beats[1].click).toBe(true);
    expect(beats[2].cursor).toEqual({ x: 60, y: 50 }); // stays where it was
    expect(beats[2].kept).toEqual([{ x: 30, y: 40, text: 'ABC' }]); // typed value stays in its field
    expect(beats[3].image).toBe('/b.webp');
    expect(beats[3].prevImage).toBe('/a.webp');
    expect(beats[3].kept).toEqual([]); // a new screenshot clears it
    expect(beats[3].d.out).toBeGreaterThan(1000); // the last step never fades out
  });

  it('orders the beat: move, click, then typing, toast inside the step', () => {
    const [, b] = buildTimeline(base).beats;
    expect(b.d.click).toBeGreaterThan(b.d.move);
    expect(b.d.type).toBeGreaterThan(b.d.click);
    expect(b.d.type + 3 * b.d.cps).toBeLessThan(b.len);
  });

  it('moves the caption to the top when the action is near the bottom', () => {
    const { beats } = buildTimeline(base);
    expect(beats[0].top).toBe(false);
    expect(beats[2].top).toBe(true);
  });
});

describe('camFor', () => {
  it('is identity without a box', () => expect(camFor()).toEqual(NO_CAM));

  it('scales about the box centre and keeps the box inside the frame', () => {
    const box = { x: 40, y: 40, w: 20, h: 20 };
    const cam = camFor(box);
    expect(cam.s).toBeGreaterThan(1);
    expect(cam.s).toBeLessThanOrEqual(1.45);
    expect(project(cam, 50, 'x')).toBeCloseTo(50, 2); // centred box: its centre is the fixed point
    for (const box2 of [box, { x: 0, y: 0, w: 18, h: 10 }, { x: 85, y: 88, w: 15, h: 12 }]) {
      const c = camFor(box2);
      expect(project(c, box2.x, 'x')).toBeGreaterThanOrEqual(-0.01);
      expect(project(c, box2.x + box2.w, 'x')).toBeLessThanOrEqual(100.01);
      expect(project(c, box2.y, 'y')).toBeGreaterThanOrEqual(-0.01);
      expect(project(c, box2.y + box2.h, 'y')).toBeLessThanOrEqual(100.01);
      // the frame stays covered by the screenshot (no empty edges)
      expect(c.x).toBeLessThanOrEqual(0);
      expect(c.x + 100 * c.s).toBeGreaterThanOrEqual(100);
    }
  });
});
