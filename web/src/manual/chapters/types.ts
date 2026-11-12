import type { Walkthrough } from '../walkthrough/types';
export type ManualGroup = 'Car Spa' | 'Facturación electrónica' | 'Punto de venta' | 'Administración';
export interface ManualFigure { src: string; alt: string; caption?: string }          // src '/manual/img/<file>.webp'
export interface ManualCallout { kind: 'info' | 'warning'; title: string; body: string }
export interface ManualSection { id: string; title: string; body: string[]; steps?: string[]; figure?: ManualFigure; callout?: ManualCallout }
export interface ManualChapter {
  id: string;            // kebab-case, unique, used as the anchor (#id)
  order: number;         // global order: Car Spa 100-199, Facturación 200-299, Punto de venta 300-399, Administración 400-499
  group: ManualGroup;
  title: string;
  summary: string;       // one sentence
  sections: ManualSection[];
  walkthrough?: Walkthrough;  // the chapter's animated "video"
}
