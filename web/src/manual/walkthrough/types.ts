export interface Box { x: number; y: number; w: number; h: number }   // percent of the screenshot, 0-100
export interface WalkStep {
  at: number;                // seconds from the start of the walkthrough
  dur: number;               // seconds the step stays on screen
  caption: string;           // Spanish caption, real text (also listed under the player for accessibility)
  image?: string;            // switch to another screenshot ('/manual/img/<file>.webp') from this step on
  highlight?: Box;           // ring + dimmed surroundings around a control or area
  cursor?: { x: number; y: number; click?: boolean };   // pointer moves here (percent), optional click ripple
  type?: { x: number; y: number; text: string };        // text typed into a field at that point
  toast?: string;            // a confirmation chip (e.g. "Servicio creado")
  zoom?: Box;                // gentle zoom into this area (transform only)
}
export interface Walkthrough { id: string; title: string; image: string; aspect: number; steps: WalkStep[] } // aspect = w/h
