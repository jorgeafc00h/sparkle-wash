// Animated walkthrough player for the Car Spa manual: real screenshots plus HTML/CSS overlays
// (highlight ring, pointer, click ripple, typed text, toast, zoom, caption). No video files.
// Overlay boxes are positioned in percent of the screenshot, so they stay aligned at any width.
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { Walkthrough } from './types';
import { buildTimeline, r3, type Cam } from './timeline';
import { useWalkthrough } from './useWalkthrough';
import './walkthrough.css';

export interface WalkthroughPlayerProps {
  data: Walkthrough;
  /** Language of the controls; captions come from the data as written. */
  lang?: string;
  /** Start playing the first time the player scrolls into view (never under reduced motion). */
  autoPlay?: boolean;
  className?: string;
}

const TEXT = {
  es: {
    region: 'Recorrido animado', play: 'Reproducir', pause: 'Pausar', replay: 'Ver de nuevo', restart: 'Reiniciar',
    prev: 'Paso anterior', next: 'Paso siguiente', steps: 'Pasos del recorrido', progress: 'Progreso del recorrido',
    step: (n: number, t: number) => `Paso ${n} de ${t}`,
  },
  en: {
    region: 'Animated walkthrough', play: 'Play', pause: 'Pause', replay: 'Play again', restart: 'Restart',
    prev: 'Previous step', next: 'Next step', steps: 'Walkthrough steps', progress: 'Walkthrough progress',
    step: (n: number, t: number) => `Step ${n} of ${t}`,
  },
};

const pc = (v: number) => `${r3(v)}%`;
const sec = (v: number) => `${r3(v)}s`;
type Vars = CSSProperties & Record<`--${string}`, string | number>;
const camVars = (c: Cam, n: 0 | 1): Vars => ({ [`--zs${n}`]: c.s, [`--zx${n}`]: pc(c.x), [`--zy${n}`]: pc(c.y) });

const Icon = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"
    fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const PLAY = 'M8 5.6v12.8a.8.8 0 0 0 1.2.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4A.8.8 0 0 0 8 5.6z';
const PAUSE = 'M7 5h3.4v14H7zM13.6 5H17v14h-3.4z';
const PREV = 'M14.5 6l-6 6 6 6';
const NEXT = 'M9.5 6l6 6-6 6';
const RESTART = 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9M4.5 4.5V9H9';
const CHECK = 'M5.5 12.5l4 4 9-9';

export function WalkthroughPlayer({ data, lang = 'es', autoPlay = true, className }: WalkthroughPlayerProps) {
  const L = lang.startsWith('en') ? TEXT.en : TEXT.es;
  const { beats, total } = useMemo(() => buildTimeline(data), [data]);
  const { state, reduced, stageRef, fillRef, toggle, restart, jump, prev, next } = useWalkthrough(beats, total, autoPlay);
  const preloaded = useRef(new Set<string>());
  const n = beats.length;
  const i = Math.min(state.i, Math.max(0, n - 1));
  const b = beats[i];
  const aspect = data.aspect > 0 ? data.aspect : 16 / 9;

  // Preload the next screenshot so the crossfade never waits on the network.
  useEffect(() => {
    const cur = beats[i]?.image;
    const upcoming = beats.slice(i + 1).find((x) => x.image !== cur)?.image;
    if (!upcoming || preloaded.current.has(upcoming) || typeof Image === 'undefined') return;
    preloaded.current.add(upcoming);
    const img = new Image();
    img.decoding = 'async';
    img.src = upcoming;
  }, [beats, i]);

  if (!b) {
    return (
      <div className={`cs-w cs-w-static${className ? ` ${className}` : ''}`} role="group" aria-label={`${L.region}: ${data.title}`}>
        <div className="cs-w-stage" style={{ aspectRatio: String(aspect) }}>
          <img className="cs-w-img cs-w-img--current" src={data.image} alt={data.title} />
        </div>
      </div>
    );
  }

  const { step, d } = b;
  const live = state.live;
  const vars: Vars = {
    '--t0': '0s', '--dur': sec(b.len), '--md': sec(d.move), '--dc': sec(d.click), '--dt': sec(d.type),
    '--cps': sec(d.cps), '--dtoast': sec(d.toast), '--dout': sec(d.out), '--zd': sec(d.zoom),
    ...camVars(b.camFrom, 0), ...camVars(b.cam, 1),
  };
  const playLabel = state.playing ? L.pause : state.ended ? L.replay : L.play;
  const atStart = i === 0;
  const atEnd = i === n - 1;
  const counter = L.step(i + 1, n);
  const cls = ['cs-w', live ? 'cs-w-live' : 'cs-w-static', state.playing ? '' : 'cs-w-paused', className]
    .filter(Boolean).join(' ');

  return (
    <div className={cls} style={vars} role="group" aria-label={`${L.region}: ${data.title}`} data-step={i + 1}
      data-playing={state.playing ? 'true' : 'false'}>
      <div className="cs-w-screen">
        <div className="cs-w-stage" ref={stageRef} style={{ aspectRatio: String(aspect) }}>
          <div className={`cs-w-frame cs-w-z${state.key % 2}`}>
            {live && b.prevImage && <img className="cs-w-img" src={b.prevImage} alt="" aria-hidden="true" />}
            <img key={b.image} className={`cs-w-img cs-w-img--current${b.prevImage ? ' cs-w-img--in' : ''}`}
              src={b.image} alt={data.title} decoding="async" draggable={false} />
            <div key={state.key} className="cs-w-layer" aria-hidden="true">
              {b.kept.map((k) => (
                <span key={`${k.x},${k.y}`} className="cs-w-typed cs-w-kept" style={{ left: pc(k.x), top: pc(k.y) }}>
                  {k.text}
                </span>
              ))}
              {step.highlight && (
                <span className="cs-w-ring" style={{
                  left: pc(step.highlight.x), top: pc(step.highlight.y),
                  width: pc(step.highlight.w), height: pc(step.highlight.h),
                }} />
              )}
              {step.type && (
                <span className="cs-w-typed" style={{ left: pc(step.type.x), top: pc(step.type.y) }}>
                  {Array.from(step.type.text).map((ch, k) => (
                    <span key={k} style={{ '--k': k } as Vars}>{ch}</span>
                  ))}
                </span>
              )}
              {b.cursor && (
                <span className={`cs-w-cursor${b.from ? '' : ' is-new'}${b.click ? ' cs-w-click' : ''}`} style={{
                  '--tx': pc(b.cursor.x), '--ty': pc(b.cursor.y),
                  '--fx': pc(b.from ? b.from.x : b.cursor.x + 5), '--fy': pc(b.from ? b.from.y : b.cursor.y + 9),
                } as Vars}>
                  {b.click && <span className="cs-w-ripple" />}
                  <svg viewBox="2.2 1.6 17 22" focusable="false">
                    <path d="M3.2 2.6v16.6l4.6-4.2 3 6.8 3.1-1.4-3-6.6h6.3z" fill="#fff" stroke="#0B1530"
                      strokeWidth="1.4" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </div>
          </div>
          {step.toast && (
            <div className="cs-w-toastbar" data-pos={b.top ? 'bottom' : 'top'}>
              <span key={state.key} className="cs-w-toast">
                <Icon d={CHECK} />
                {step.toast}
              </span>
            </div>
          )}
        </div>
        <div className="cs-w-cap" data-pos={b.top ? 'top' : 'bottom'} aria-live="polite" aria-atomic="true">
          <div key={state.key} className="cs-w-pill">
            <span className="cs-w-num" aria-hidden="true">{i + 1}/{n}</span>
            <span className="cs-w-vh">{counter}: </span>
            <span className="cs-w-text">{step.caption}</span>
          </div>
        </div>
      </div>

      <div className="cs-w-bar" role="progressbar" aria-label={L.progress} aria-valuemin={1} aria-valuemax={n}
        aria-valuenow={i + 1} aria-valuetext={counter}>
        <span className="cs-w-track"><span className="cs-w-fill" ref={fillRef} /></span>
        {beats.map((x) => (
          <span key={x.i} className={`cs-w-mark${x.i <= i ? ' is-done' : ''}`}
            style={{ left: pc(total ? (x.start / total) * 100 : 0) }} />
        ))}
      </div>

      <div className="cs-w-controls">
        <button type="button" className="cs-w-btn" aria-label={L.prev} aria-disabled={atStart || undefined}
          onClick={() => !atStart && prev()}><Icon d={PREV} /></button>
        <button type="button" className="cs-w-btn cs-w-btn--main" aria-label={playLabel} onClick={toggle}>
          <Icon d={state.playing ? PAUSE : PLAY} fill />
        </button>
        <button type="button" className="cs-w-btn" aria-label={L.next} aria-disabled={atEnd || undefined}
          onClick={() => !atEnd && next()}><Icon d={NEXT} /></button>
        <span className="cs-w-count" aria-hidden="true">{i + 1} / {n}</span>
        <button type="button" className="cs-w-btn" aria-label={L.restart} onClick={restart}><Icon d={RESTART} /></button>
      </div>

      <ol className="cs-w-steps" role="list" aria-label={L.steps}>
        {beats.map((x) => (
          <li key={x.i}>
            <button type="button" className="cs-w-step" aria-current={x.i === i ? 'step' : undefined}
              onClick={() => {
                jump(x.i);
                stageRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
              }}>
              <span className="cs-w-step-n" aria-hidden="true">{x.i + 1}</span>
              <span>{x.step.caption}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default WalkthroughPlayer;
