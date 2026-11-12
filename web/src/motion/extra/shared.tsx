import { useRef, useState } from "react";
import { useSceneVisibility } from "../useSceneVisibility";
import "./extra.css";

/** The landing speaks Spanish first; English is the only other locale the site ships. */
export type ExtraLocale = "es" | "en";

/**
 * Everything a scene needs to drive CSS keyframes: animations run only while the scene is on screen, the
 * visitor has not paused it, and reduced motion is off. The scene root gets `data-play="on|off"` and
 * `data-motion="full|reduced"`; extra.css turns those into `animation-play-state` / `animation: none`.
 */
export function useSceneMotion<T extends Element>() {
  const ref = useRef<T>(null);
  // W2's shared hook: plays from 20 % visible, pauses once fully offscreen, tracks prefers-reduced-motion live.
  const { inView, reducedMotion: reduced } = useSceneVisibility(ref, { threshold: 0.2 });
  const [paused, setPaused] = useState(false);
  const playing = inView && !paused && !reduced;
  return {
    ref,
    reduced,
    inView,
    paused,
    togglePaused: () => setPaused((p) => !p),
    rootProps: { "data-play": playing ? "on" : "off", "data-motion": reduced ? "reduced" : "full" } as const,
  };
}

const PAUSE_TEXT: Record<ExtraLocale, { pause: string; play: string }> = {
  es: { pause: "Pausar animación", play: "Reanudar animación" },
  en: { pause: "Pause animation", play: "Resume animation" },
};

/** WCAG 2.2.2 control for looping scenes. The visible label is the accessible name, so it changes with the state. */
export function PauseButton({ paused, onToggle, locale }: { paused: boolean; onToggle: () => void; locale: ExtraLocale }) {
  const text = PAUSE_TEXT[locale];
  return (
    <button type="button" className="cs-x-pause" onClick={onToggle} data-paused={paused ? "true" : "false"}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        {paused
          ? <path d="M4 2.5v11l9.5-5.5z" fill="currentColor" />
          : <path d="M4 2.5h3v11H4zm5 0h3v11H9z" fill="currentColor" />}
      </svg>
      <span>{paused ? text.play : text.pause}</span>
    </button>
  );
}

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}
