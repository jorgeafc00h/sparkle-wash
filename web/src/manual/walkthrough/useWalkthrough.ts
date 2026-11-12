// Playback state for the walkthrough player.
// One requestAnimationFrame clock advances time while playing; React state changes only when the
// step changes, so the progress bar is painted straight to the DOM and nothing re-renders per frame.
// The CSS keyframes run beside the clock; pausing sets animation-play-state, so both stop together.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Beat } from './timeline';

export interface PlayerState {
  i: number;          // current step
  playing: boolean;
  live: boolean;      // the step's overlays animate (false = static settled frame)
  key: number;        // bumps whenever a step (re)starts, remounting its overlay layer
  ended: boolean;
}

const RM = '(prefers-reduced-motion: reduce)';
const mq = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(RM) : null);

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => !!mq()?.matches);
  useEffect(() => {
    const m = mq();
    if (!m) return;
    const on = () => setReduced(m.matches);
    on();
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function useWalkthrough(beats: Beat[], total: number, autoPlay: boolean) {
  const reduced = useReducedMotion();
  const [state, setState] = useState<PlayerState>({ i: 0, playing: false, live: false, key: 0, ended: false });
  const sRef = useRef(state);
  const tRef = useRef(0); // seconds elapsed inside the current step
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const autoRef = useRef(autoPlay);
  autoRef.current = autoPlay;
  const beatsRef = useRef(beats);
  beatsRef.current = beats;
  const flags = useRef({ autoDone: false, touched: false, viewPaused: false, inView: false });
  const stageRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);

  const commit = useCallback((patch: Partial<PlayerState>) => {
    const next = { ...sRef.current, ...patch };
    sRef.current = next;
    setState(next);
  }, []);

  const paint = useCallback(() => {
    const b = beatsRef.current[sRef.current.i];
    if (fillRef.current && b && total > 0) {
      fillRef.current.style.transform = `scaleX(${Math.min(1, (b.start + tRef.current) / total).toFixed(4)})`;
    }
  }, [total]);

  const go = useCallback((i: number, playing = sRef.current.playing) => {
    tRef.current = 0;
    const last = beatsRef.current.length - 1;
    commit({ i: Math.max(0, Math.min(last, i)), playing, live: playing && !reducedRef.current, key: sRef.current.key + 1, ended: false });
  }, [commit]);

  const play = useCallback(() => {
    const s = sRef.current;
    if (s.ended) return go(0, true);
    if (s.live && !reducedRef.current) return commit({ playing: true }); // resume mid-step
    tRef.current = 0; // a static frame starts its step from the beginning
    commit({ playing: true, live: !reducedRef.current, key: s.key + 1 });
  }, [commit, go]);

  const pause = useCallback(() => commit({ playing: false }), [commit]);

  // The clock: one rAF loop that lives exactly as long as playback.
  useEffect(() => {
    if (!state.playing) return;
    let raf = 0;
    let last = now();
    const frame = () => {
      const t = now();
      tRef.current += Math.min(0.1, Math.max(0, (t - last) / 1000)); // clamp tab-switch jumps
      last = t;
      const s = sRef.current;
      const list = beatsRef.current;
      const b = list[s.i];
      if (!b) return;
      if (tRef.current >= b.len) {
        if (s.i >= list.length - 1) {
          tRef.current = b.len;
          paint();
          commit({ playing: false, ended: true });
          return;
        }
        tRef.current -= b.len;
        commit({ i: s.i + 1, key: s.key + 1, live: !reducedRef.current });
      }
      paint();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state.playing, commit, paint]);

  // Keep the progress bar right after jumps, pauses and the end.
  useLayoutEffect(paint, [state, paint]);

  // Switching to reduced motion mid-play drops to static frames.
  useEffect(() => {
    if (reduced && sRef.current.live) commit({ live: false, playing: false });
  }, [reduced, commit]);

  // Auto-play once when the stage becomes visible; pause offscreen or in a hidden tab, resume after.
  useEffect(() => {
    const el = stageRef.current;
    const f = flags.current;
    const wake = () => {
      if (f.viewPaused) {
        f.viewPaused = false;
        play();
      } else if (!f.autoDone) {
        f.autoDone = true;
        if (autoRef.current && !f.touched && !reducedRef.current && !sRef.current.playing) play();
      }
    };
    const sleep = () => {
      if (sRef.current.playing) {
        f.viewPaused = true;
        pause();
      }
    };
    const onVisibility = () => (document.hidden ? sleep() : f.inView && wake());
    document.addEventListener('visibilitychange', onVisibility);
    let io: IntersectionObserver | undefined;
    if (el && typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const ratio = e.isIntersecting ? e.intersectionRatio : 0;
          if (ratio >= 0.5) {
            f.inView = true;
            if (!document.hidden) wake();
          } else if (ratio < 0.2) {
            f.inView = false;
            sleep();
          }
        }
      }, { threshold: [0, 0.2, 0.5] });
      io.observe(el);
    }
    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [play, pause]);

  // User actions cancel any pending auto-play and auto-resume.
  const user = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => {
    flags.current.touched = true;
    flags.current.viewPaused = false;
    fn(...a);
  };
  return {
    state,
    reduced,
    stageRef,
    fillRef,
    toggle: user(() => (sRef.current.playing ? pause() : play())),
    restart: user(() => go(0, true)),
    jump: user((i: number) => go(i)),
    prev: user(() => go(sRef.current.i - 1)),
    next: user(() => go(sRef.current.i + 1)),
  };
}
