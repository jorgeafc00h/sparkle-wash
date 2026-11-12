import type { ManualChapter, ManualGroup } from './types';

const modules = import.meta.glob<{ default: ManualChapter }>('./*.chapter.ts', { eager: true });

/** Every chapter file in this folder, sorted by `order`. */
export const chapters: ManualChapter[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.order - b.order);

export const GROUP_ORDER: ManualGroup[] = ['Car Spa', 'Facturación electrónica', 'Punto de venta', 'Administración'];

export function chaptersByGroup(list: ManualChapter[] = chapters): Array<{ group: ManualGroup; chapters: ManualChapter[] }> {
  return GROUP_ORDER.map((group) => ({ group, chapters: list.filter((c) => c.group === group) })).filter((g) => g.chapters.length > 0);
}
