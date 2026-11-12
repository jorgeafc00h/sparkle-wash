import { describe, expect, it } from 'vitest';
import type { Box } from '../walkthrough/types';
import type { ManualChapter } from '../chapters/types';

const mine = import.meta.glob<{ default: ManualChapter }>('../chapters/admin-*.chapter.ts', { eager: true });
const everyone = import.meta.glob<{ default: ManualChapter }>('../chapters/*.chapter.ts', { eager: true });
const imageFiles = new Set(
  Object.keys(import.meta.glob('../../../public/manual/img/*.webp')).map((p) => p.split('/').pop() as string),
);

const chapters = Object.values(mine).map((m) => m.default);
const basename = (src: string) => src.split('/').pop() as string;
const insideFrame = (b: Box) => b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 100.05 && b.y + b.h <= 100.05;

describe('Administración chapters', () => {
  it('has between 5 and 14 chapters', () => {
    expect(chapters.length).toBeGreaterThanOrEqual(5);
    expect(chapters.length).toBeLessThanOrEqual(14);
  });

  it('has unique kebab-case ids across the whole manual', () => {
    const all = Object.values(everyone).map((m) => m.default.id);
    expect(new Set(all).size).toBe(all.length);
    for (const c of chapters) expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('has unique orders inside 400-499 and the right group', () => {
    const orders = chapters.map((c) => c.order);
    expect(new Set(orders).size).toBe(orders.length);
    const all = Object.values(everyone).map((m) => m.default.order);
    expect(new Set(all).size).toBe(all.length);
    for (const c of chapters) {
      expect(c.group).toBe('Administración');
      expect(c.order).toBeGreaterThanOrEqual(400);
      expect(c.order).toBeLessThanOrEqual(499);
    }
  });

  for (const c of chapters) {
    describe(c.id, () => {
      it('has title, summary and sections with unique ids and real copy', () => {
        expect(c.title.length).toBeGreaterThan(3);
        expect(c.summary.length).toBeGreaterThan(20);
        expect(c.sections.length).toBeGreaterThanOrEqual(2);
        const ids = c.sections.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const s of c.sections) {
          expect(s.title.length).toBeGreaterThan(2);
          expect(s.body.length).toBeGreaterThan(0);
          for (const p of s.body) expect(p.trim().length).toBeGreaterThan(20);
          if (s.callout) expect(['info', 'warning']).toContain(s.callout.kind);
          if (s.steps) expect(s.steps.length).toBeGreaterThan(0);
        }
      });

      it('references only images that exist, with alt text', () => {
        const figures = c.sections.flatMap((s) => (s.figure ? [s.figure] : []));
        expect(figures.length).toBeGreaterThan(0);
        for (const f of figures) {
          expect(f.src).toMatch(/^\/manual\/img\/[a-z0-9-]+\.webp$/);
          expect(f.alt.length).toBeGreaterThan(10);
          expect(imageFiles.has(basename(f.src)), f.src).toBe(true);
        }
      });

      it('has a walkthrough of 4-8 steps, 12-30 s, all inside the frame', () => {
        const w = c.walkthrough;
        expect(w, 'walkthrough').toBeDefined();
        if (!w) return;
        expect(w.id).toBe(c.id);
        expect(w.aspect).toBeGreaterThan(1.7);
        expect(w.aspect).toBeLessThan(1.8);
        expect(imageFiles.has(basename(w.image)), w.image).toBe(true);
        expect(w.steps.length).toBeGreaterThanOrEqual(4);
        expect(w.steps.length).toBeLessThanOrEqual(8);
        const total = Math.max(...w.steps.map((s) => s.at + s.dur));
        expect(total).toBeGreaterThanOrEqual(12);
        expect(total).toBeLessThanOrEqual(30);
        let prev = -1;
        for (const s of w.steps) {
          expect(s.at).toBeGreaterThanOrEqual(prev);
          prev = s.at;
          expect(s.dur).toBeGreaterThan(0);
          expect(s.caption.length).toBeGreaterThan(10);
          if (s.image) expect(imageFiles.has(basename(s.image)), s.image).toBe(true);
          if (s.highlight) expect(insideFrame(s.highlight), JSON.stringify(s.highlight)).toBe(true);
          if (s.zoom) expect(insideFrame(s.zoom), JSON.stringify(s.zoom)).toBe(true);
          if (s.cursor) {
            expect(s.cursor.x).toBeGreaterThanOrEqual(0);
            expect(s.cursor.x).toBeLessThanOrEqual(100);
            expect(s.cursor.y).toBeGreaterThanOrEqual(0);
            expect(s.cursor.y).toBeLessThanOrEqual(100);
          }
          if (s.type) {
            expect(s.type.x).toBeGreaterThanOrEqual(0);
            expect(s.type.x).toBeLessThanOrEqual(100);
            expect(s.type.y).toBeGreaterThanOrEqual(0);
            expect(s.type.y).toBeLessThanOrEqual(100);
            expect(s.type.text.length).toBeGreaterThan(0);
          }
        }
      });
    });
  }
});
