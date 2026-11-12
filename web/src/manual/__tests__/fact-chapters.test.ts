import { describe, expect, it } from 'vitest';
import type { ManualChapter } from '../chapters/types';
import type { Box } from '../walkthrough/types';

const modules = import.meta.glob<{ default: ManualChapter }>('../chapters/fact-*.chapter.ts', { eager: true });
const chapters: ManualChapter[] = Object.values(modules).map((m) => m.default);
const imageFiles = new Set(Object.keys(import.meta.glob('../../../public/manual/img/fact-*.webp')).map((p) => p.split('/').pop()!));

const basename = (src: string) => src.split('/').pop()!;
const inRange = (n: number) => n >= 0 && n <= 100;
const boxOk = (b: Box) => inRange(b.x) && inRange(b.y) && b.w > 0 && b.h > 0 && b.x + b.w <= 100.2 && b.y + b.h <= 100.2;

describe('Facturación electrónica chapters', () => {
  it('has between 8 and 11 chapters', () => {
    expect(chapters.length).toBeGreaterThanOrEqual(8);
    expect(chapters.length).toBeLessThanOrEqual(11);
  });

  it('uses unique ids and unique orders', () => {
    expect(new Set(chapters.map((c) => c.id)).size).toBe(chapters.length);
    expect(new Set(chapters.map((c) => c.order)).size).toBe(chapters.length);
  });

  describe.each(chapters.map((c) => [c.id, c] as const))('%s', (_id, chapter) => {
    it('has kebab-case id with the fact- prefix, group and order in range', () => {
      expect(chapter.id).toMatch(/^fact-[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(chapter.group).toBe('Facturación electrónica');
      expect(chapter.order).toBeGreaterThanOrEqual(200);
      expect(chapter.order).toBeLessThanOrEqual(299);
      expect(chapter.title.length).toBeGreaterThan(3);
      expect(chapter.summary.length).toBeGreaterThan(10);
    });

    it('has sections with unique ids and body text', () => {
      expect(chapter.sections.length).toBeGreaterThan(0);
      expect(new Set(chapter.sections.map((s) => s.id)).size).toBe(chapter.sections.length);
      for (const s of chapter.sections) {
        expect(s.body.length).toBeGreaterThan(0);
        if (s.steps) expect(s.steps.length).toBeGreaterThan(0);
      }
    });

    it('references figure images that exist', () => {
      const figures = chapter.sections.flatMap((s) => (s.figure ? [s.figure] : []));
      expect(figures.length).toBeGreaterThan(0);
      for (const f of figures) {
        expect(f.src).toMatch(/^\/manual\/img\/fact-[a-z0-9-]+\.webp$/);
        expect(f.alt.length).toBeGreaterThan(5);
        expect(imageFiles.has(basename(f.src)), `missing image ${f.src}`).toBe(true);
      }
    });

    it('has a walkthrough with 4-8 steps inside its bounds', () => {
      const w = chapter.walkthrough;
      expect(w).toBeDefined();
      if (!w) return;
      expect(imageFiles.has(basename(w.image)), `missing image ${w.image}`).toBe(true);
      expect(w.aspect).toBeGreaterThan(1.7);
      expect(w.aspect).toBeLessThan(1.8);
      expect(w.steps.length).toBeGreaterThanOrEqual(4);
      expect(w.steps.length).toBeLessThanOrEqual(8);
      let prevEnd = 0;
      for (const s of w.steps) {
        expect(s.at).toBeGreaterThanOrEqual(prevEnd - 0.2);
        expect(s.dur).toBeGreaterThan(0);
        expect(s.caption.length).toBeGreaterThan(5);
        prevEnd = s.at + s.dur;
        if (s.image) expect(imageFiles.has(basename(s.image)), `missing image ${s.image}`).toBe(true);
        for (const b of [s.highlight, s.zoom]) if (b) expect(boxOk(b), JSON.stringify(b)).toBe(true);
        if (s.cursor) {
          expect(inRange(s.cursor.x)).toBe(true);
          expect(inRange(s.cursor.y)).toBe(true);
        }
        if (s.type) {
          expect(inRange(s.type.x)).toBe(true);
          expect(inRange(s.type.y)).toBe(true);
          expect(s.type.text.length).toBeGreaterThan(0);
        }
      }
      expect(prevEnd).toBeGreaterThanOrEqual(12);
      expect(prevEnd).toBeLessThanOrEqual(30);
    });
  });

  it('does not leave unused fact images behind', () => {
    const used = new Set<string>();
    for (const c of chapters) {
      for (const s of c.sections) if (s.figure) used.add(basename(s.figure.src));
      if (c.walkthrough) {
        used.add(basename(c.walkthrough.image));
        for (const st of c.walkthrough.steps) if (st.image) used.add(basename(st.image));
      }
    }
    for (const f of imageFiles) expect(used.has(f), `unused image ${f}`).toBe(true);
  });
});
