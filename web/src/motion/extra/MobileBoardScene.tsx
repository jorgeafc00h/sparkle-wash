import type { CSSProperties } from "react";
import { cx, PauseButton, useSceneMotion, type ExtraLocale } from "./shared";
import "./mobile-board.css";

export interface MobileBoardSceneProps {
  locale?: ExtraLocale;
  /** Phone screen capture (780×1520). The overlay geometry in mobile-board.css matches this capture. */
  phoneScreen?: string;
  /** Tablet screen capture (2560×1280, board on the right of a 19 % sidebar that is cropped away). */
  tabletScreen?: string;
  className?: string;
}

const TEXT = {
  es: {
    status: ["Llegó", "En cola", "Lavando", "Listo"],
    action: ["A la cola", "Iniciar lavado", "Marcar listo"],
    due: "Por cobrar",
    nobody: "Sin asignar",
    vehicle: "Camioneta / SUV",
    caption: "El mismo trabajo avanza a la vez en la tablet y en el teléfono: llegó, en cola, lavando y listo, y queda por cobrar en la caja.",
    steps: "Estados del trabajo",
  },
  en: {
    status: ["Arrived", "Queued", "Washing", "Done"],
    action: ["Queue", "Start wash", "Mark done"],
    due: "Unpaid",
    nobody: "Unassigned",
    vehicle: "SUV",
    caption: "The same job moves on the tablet and the phone at once: arrived, queued, washing and done, then it waits to be paid at the register.",
    steps: "Job states",
  },
} as const;

/* Demo job, in the same format as the console's demo data. The package name comes from the catalog. */
const PLATE = "P524301";
const PACKAGE = "Supreme Spa";
/* Minutes shown on the card's timer at each stage; the seconds tick live (keyframed digit strips). */
const MINUTES = ["0", "3", "9", "18"];
/* Ones digit of the seconds: 0…9 then 0…6, one line per step (see cs-x-b-ones). */
const ONES = "01234567890123456".split("").flatMap((d, i) => (i ? [<br key={i} />, d] : [d]));

/** Four stacked labels, one visible per stage (shared 16 s cycle; see .cs-x-b-q in the CSS). */
function Staged({ items, className }: { items: readonly string[]; className?: string }) {
  return (
    <span className={cx("cs-x-b-stack", className)}>
      {items.map((item, i) => (
        <span key={i} className="cs-x-b-q cs-x-anim" style={{ "--i": i } as CSSProperties} data-last={i === items.length - 1 ? "" : undefined}>
          {item}
        </span>
      ))}
    </span>
  );
}

function Timer() {
  return (
    <span className="cs-x-b-timer">
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 4.6V8l2.3 1.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      <Staged items={MINUTES} className="cs-x-b-min" />
      <span>m</span>
      <span className="cs-x-b-sec">
        &nbsp;
        <span className="cs-x-b-digit"><span className="cs-x-b-strip cs-x-b-tens cs-x-anim">0<br />1</span></span>
        <span className="cs-x-b-digit"><span className="cs-x-b-strip cs-x-b-ones cs-x-anim">{ONES}</span></span>
        s
      </span>
    </span>
  );
}

function JobCard({ t, where }: { t: (typeof TEXT)[ExtraLocale]; where: "tablet" | "phone" }) {
  return (
    <div className={`cs-x-b-card cs-x-b-card--${where} cs-x-anim`}>
      <div className="cs-x-b-row">
        <span className="cs-x-b-plate">{PLATE}</span>
        <Timer />
      </div>
      <strong className="cs-x-b-pkg">{PACKAGE}</strong>
      <span className="cs-x-b-cls">{t.vehicle}</span>
      <div className="cs-x-b-crew">
        <span className="cs-x-b-nobody cs-x-b-q cs-x-anim" style={{ "--i": 0 } as CSSProperties}>{t.nobody}</span>
        <span className="cs-x-b-avatar cs-x-anim">MG</span>
      </div>
      <div className="cs-x-b-foot">
        <span className="cs-x-b-action">
          <Staged items={[...t.action, ""]} />
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {where === "phone" && <span className="cs-x-b-tap cs-x-anim" />}
        </span>
        <span className="cs-x-b-due cs-x-anim">{t.due}</span>
      </div>
    </div>
  );
}

/**
 * Tablet and phone (CSS-built frames, no device logos) showing the Car Spa job board. One job advances
 * Llegó → En cola → Lavando → Listo on both screens in sync, its timer ticking, until it shows "Por cobrar".
 * 16 s loop, paused offscreen, with a "Pausar animación" control. Reduced motion shows the job done and unpaid.
 */
export function MobileBoardScene({
  locale = "es",
  phoneScreen = "/landing/screens/tablero-movil.jpg",
  tabletScreen = "/landing/screens/tablero.jpg",
  className,
}: MobileBoardSceneProps) {
  const t = TEXT[locale];
  const { ref, rootProps, reduced, paused, togglePaused } = useSceneMotion<HTMLElement>();
  return (
    <figure ref={ref} className={cx("cs-x-scene cs-x-board", className)} {...rootProps}>
      <div className="cs-x-b-stage">
        <div className="cs-x-b-tablet" aria-hidden="true">
          <div className="cs-x-b-screen">
            <img className="cs-x-b-shot" src={tabletScreen} alt="" loading="lazy" decoding="async" />
            <span className="cs-x-b-scrim" />
            <JobCard t={t} where="tablet" />
          </div>
          <span className="cs-x-b-cam" />
        </div>

        <div className="cs-x-b-phone" aria-hidden="true">
          <div className="cs-x-b-screen">
            <img className="cs-x-b-shot" src={phoneScreen} alt="" loading="lazy" decoding="async" />
            <div className="cs-x-b-lanes">
              <div className="cs-x-b-strip-cols cs-x-anim">
                {t.status.map((status, i) => (
                  <div key={status} className="cs-x-b-col">
                    <span className="cs-x-b-col-head"><span className="cs-x-b-col-dot" data-i={i} />{status}</span>
                  </div>
                ))}
              </div>
              <JobCard t={t} where="phone" />
            </div>
          </div>
          <span className="cs-x-b-island" />
        </div>

        {!reduced && <PauseButton paused={paused} onToggle={togglePaused} locale={locale} />}
      </div>

      <figcaption className="cs-x-b-caption">
        <span className="cs-x-sr">{t.caption}</span>
        <div className="cs-x-b-steps">
          <ol aria-label={t.steps}>
            {t.status.map((status) => <li key={status}>{status}</li>)}
          </ol>
          <span className="cs-x-b-steps-bar cs-x-anim" aria-hidden="true" />
        </div>
        <span className="cs-x-b-chip cs-x-anim">{t.due}</span>
      </figcaption>
    </figure>
  );
}
