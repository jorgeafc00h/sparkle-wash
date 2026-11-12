// Every chapter's walkthrough: a zoomed step must keep its highlight (and pointer) inside the zoomed view,
// otherwise the ring is pushed out of the frame and the step points at nothing.
import { describe, expect, it } from 'vitest';
import { chapters } from '../chapters';
import type { Box } from '../walkthrough/types';

const contains = (outer: Box, inner: Box, slack = 0.5) =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  inner.x + inner.w <= outer.x + outer.w + slack &&
  inner.y + inner.h <= outer.y + outer.h + slack;

describe('walkthrough geometry (all chapters)', () => {
  const withWalkthrough = chapters.filter((c) => c.walkthrough);

  it('covers every chapter that has a walkthrough', () => {
    expect(withWalkthrough.length).toBeGreaterThan(30);
  });

  for (const chapter of withWalkthrough) {
    it(`${chapter.id}: zoomed steps keep the highlight and pointer in view`, () => {
      chapter.walkthrough!.steps.forEach((step, i) => {
        if (!step.zoom) return;
        if (step.highlight) expect(contains(step.zoom, step.highlight), `step ${i + 1} highlight`).toBe(true);
        if (step.cursor) {
          const { x, y } = step.cursor;
          expect(contains(step.zoom, { x, y, w: 0, h: 0 }), `step ${i + 1} pointer`).toBe(true);
        }
      });
    });
  }
});
