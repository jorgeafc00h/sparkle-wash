import { useCallback, useEffect, useRef, useState, type AnimationEvent, type RefObject } from "react";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function readReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_QUERY).matches;
}

/** Tracks `prefers-reduced-motion`, including changes while the page is open. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_QUERY);
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export interface SceneVisibilityOptions {
  /** Fraction of the scene that must be visible before it starts playing (it pauses once fully offscreen). */
  threshold?: number;
  rootMargin?: string;
}

export interface SceneVisibility {
  /** In view and motion allowed: drives `data-playing`, and so `animation-play-state`. */
  playing: boolean;
  inView: boolean;
  reducedMotion: boolean;
}

/**
 * IntersectionObserver-driven play state. A scene starts when `threshold` of it is visible and pauses as soon as it
 * leaves the viewport, so offscreen scenes cost nothing. Without IntersectionObserver the scene simply plays.
 */
export function useSceneVisibility(ref: RefObject<Element | null>, options: SceneVisibilityOptions = {}): SceneVisibility {
  const { threshold = 0.25, rootMargin = "0px" } = options;
  const reducedMotion = usePrefersReducedMotion();
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target !== element) continue;
          // Hysteresis: start at the threshold, stop only when the scene is fully out of view.
          setInView((was) => (entry.isIntersecting ? was || entry.intersectionRatio >= threshold : false));
        }
      },
      { threshold: [0, threshold], rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, threshold, rootMargin]);

  return { playing: inView && !reducedMotion, inView, reducedMotion };
}

export interface SceneControllerOptions extends SceneVisibilityOptions {
  /** Play-once scenes stop on their final frame; the control then offers a replay. */
  once?: boolean;
}

/**
 * Everything a scene root needs: the visibility hook, the user's pause toggle (WCAG 2.2.2), the end of a
 * play-once timeline (reported by a `.cs-m-clock` element) and a replay counter used as a React key.
 */
export function useSceneController(options: SceneControllerOptions = {}) {
  const ref = useRef<HTMLElement>(null);
  const { playing, reducedMotion } = useSceneVisibility(ref, options);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [run, setRun] = useState(0);

  const toggle = useCallback(() => setPaused((p) => !p), []);
  const replay = useCallback(() => {
    setEnded(false);
    setPaused(false);
    setRun((r) => r + 1);
  }, []);
  const onClockEnd = useCallback((event: AnimationEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) setEnded(true);
  }, []);

  const rootProps = {
    ref,
    "data-playing": playing ? "true" : "false",
    "data-paused": paused ? "true" : "false",
    "data-ended": ended ? "true" : "false",
    "data-reduced": reducedMotion ? "true" : "false",
  } as const;

  return { rootProps, playing, paused, ended, run, reducedMotion, toggle, replay, onClockEnd, once: !!options.once };
}
