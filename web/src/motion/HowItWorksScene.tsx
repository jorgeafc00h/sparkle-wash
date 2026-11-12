import { useId, type CSSProperties, type ReactNode } from "react";
import { MuscleCar } from "./art/MuscleCar";
import { CheckIcon, Plate, Printer } from "./art/parts";
import { HOW_COPY, type SceneLang } from "./copy";
import { SceneToggle } from "./SceneToggle";
import { StepRail } from "./StepRail";
import { useSceneController } from "./useSceneVisibility";
import "./scene-base.css";
import "./how-it-works-scene.css";

export interface HowItWorksSceneProps {
  lang?: SceneLang;
  className?: string;
  style?: CSSProperties;
}

const BEAT = 4;
const TOTAL = BEAT * 4;
const PHONE_MEDIA = "(max-width: 640px)";

/** CSS custom properties for a timeline element: `d` is its offset inside the beat, `len` its duration. */
const at = (d: number, len?: number) => ({ "--d": `${d}s`, ...(len ? { "--len": `${len}s` } : null) }) as CSSProperties;

function Beat({ n, last, kind, children }: { n: number; last?: boolean; kind: string; children: ReactNode }) {
  return (
    <div
      className={`cs-m-how__beat cs-m-how__beat--${kind} cs-m-beat cs-m-wc${last ? " cs-m-beat--last" : ""}`}
      style={{ "--t0": `${(n - 1) * BEAT}s`, "--dur": `${BEAT}s` } as CSSProperties}
    >
      <span className="cs-m-how__badge">{n}</span>
      {children}
    </div>
  );
}

/** A screenshot in a device frame; phones get the phone capture through <picture>. */
function Device({ kind, desktop, phone, children, d }: { kind: string; desktop: string; phone: string; d: number; children?: ReactNode }) {
  return (
    <div className={`cs-m-device cs-m-device--${kind} cs-m-a cs-m-up`} style={at(d, 0.7)}>
      <div className="cs-m-device__screen">
        <picture>
          <source media={PHONE_MEDIA} srcSet={phone} />
          <img src={desktop} alt="" loading="lazy" decoding="async" />
        </picture>
        {children}
      </div>
    </div>
  );
}

function EntranceCamera() {
  const beam = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-beam`;
  return (
    <svg className="cs-m-how__cam-svg" viewBox="0 0 120 230" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={beam} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FB5A00" stopOpacity=".42" />
          <stop offset="1" stopColor="#FB5A00" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon className="cs-m-how__beam" points="14,52 -66,150 -58,228" fill={`url(#${beam})`} />
      <rect x="68" y="58" width="10" height="172" rx="3" fill="#1B2A55" />
      <rect x="54" y="50" width="22" height="9" rx="3" fill="#2A3F72" />
      <path d="M 66 22 L 72 6" stroke="#B7C3D9" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M 4 30 L 76 30 L 70 21 L 12 21 Z" fill="#1B2A55" />
      <rect x="6" y="28" width="64" height="42" rx="10" fill="#13234A" stroke="#2A3F72" strokeWidth="2" />
      <circle cx="20" cy="49" r="12.5" fill="#060B1C" stroke="#4D8DFF" strokeWidth="2.4" />
      <circle cx="20" cy="49" r="5.5" fill="#1B2A55" />
      <circle cx="17" cy="46" r="2" fill="#FFFFFF" opacity=".8" />
      <circle cx="44" cy="40" r="3" fill="#FF7A2E" />
      <circle className="cs-m-how__flash" cx="20" cy="49" r="34" fill="#FFFFFF" />
    </svg>
  );
}

/**
 * "De la cámara al ticket": four 4 s beats that play once, the first time the scene is in view. The camera reads a
 * plate, staff confirm it in Review, the job crosses the board, and the register charges it and prints the work
 * ticket. Captions are a real ordered list under the stage. Reduced motion shows all four beats as a storyboard.
 */
export function HowItWorksScene({ lang = "es", className, style }: HowItWorksSceneProps) {
  const t = HOW_COPY[lang];
  const scene = useSceneController({ once: true, threshold: 0.35 });
  const titleId = useId();
  return (
    <figure
      {...scene.rootProps}
      aria-labelledby={titleId}
      lang={lang}
      className={["cs-m-scene", "cs-m-how", className].filter(Boolean).join(" ")}
      style={{ "--cs-m-total": `${TOTAL}s`, ...style } as CSSProperties}
    >
      <div className="cs-m-how__frame">
        <div key={scene.run} className="cs-m-how__stage" aria-hidden="true">
          <Beat n={1} kind="cam">
            <div className="cs-m-how__road" />
            <div className="cs-m-how__car">
              <MuscleCar />
            </div>
            <div className="cs-m-how__cam cs-m-a cs-m-up" style={at(0.1)}>
              <EntranceCamera />
            </div>
            <div className="cs-m-how__read cs-m-a cs-m-up" style={at(1.8)}>
              <p className="cs-m-how__read-head"><span className="cs-m-how__dot" />{t.camera}</p>
              <div className="cs-m-how__plate">
                <Plate text="P903377" className="cs-m-a cs-m-fade" style={at(2.25, 0.5)} />
                <svg className="cs-m-how__brackets cs-m-a cs-m-pop" style={at(2.1, 0.5)} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M0 12V0h12M88 0h12v12M100 28v12H88M12 40H0V28" fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </svg>
                <span className="cs-m-how__scan" />
              </div>
              <div className="cs-m-how__meter"><span /></div>
              <p className="cs-m-how__conf cs-m-a cs-m-fade" style={at(2.9)}>{t.confidence}</p>
            </div>
          </Beat>

          <Beat n={2} kind="review">
            <Device kind="review" desktop="/landing/screens/revision.jpg" phone="/landing/screens/revision-movil.jpg" d={0.1}>
              <span className="cs-m-how__ring cs-m-how__ring--plate cs-m-a cs-m-pop" style={at(0.9, 0.5)} />
              <span className="cs-m-how__tap cs-m-how__tap--class" style={at(1.8)} />
            </Device>
            <p className="cs-m-how__toast cs-m-a cs-m-up" style={at(2.5)}>
              <CheckIcon />
              <span>{t.jobOpened}</span>
              <Plate text="P903377" />
            </p>
          </Beat>

          <Beat n={3} kind="board">
            <Device kind="board" desktop="/landing/screens/tablero.jpg" phone="/landing/screens/tablero-movil.jpg" d={0.1}>
              <span className="cs-m-how__lane"><span className="cs-m-how__ring cs-m-how__ring--col" /></span>
              <span className="cs-m-how__tap cs-m-how__tap--advance" style={at(0.9)} />
            </Device>
            <div className="cs-m-how__states cs-m-a cs-m-up" style={at(0.5)}>
              <span className="cs-m-how__puck" />
              {t.statuses.map((s) => <span key={s} className="cs-m-how__state">{s}</span>)}
            </div>
          </Beat>

          <Beat n={4} kind="pay" last>
            <div className="cs-m-pos cs-m-a cs-m-up" style={at(0.1)}>
              <div className="cs-m-pos__bar">
                <img src="/brand/car-spa-mark-ondark.svg" alt="" width="1992" height="872" loading="lazy" decoding="async" />
                <span>{t.register}</span>
              </div>
              <div className="cs-m-pos__row">
                <Plate text="P903377" />
                <span className="cs-m-pos__class">{t.vehicle}</span>
                <span className="cs-m-pill cs-m-pill--ok">{t.ready}</span>
              </div>
              <div className="cs-m-pos__action">
                <span className="cs-m-pos__charge">{t.charge}</span>
                <span className="cs-m-pos__paid"><CheckIcon />{t.paid}</span>
              </div>
            </div>
            <Printer lang={lang} className="cs-m-how__printer cs-m-a cs-m-up" />
          </Beat>

          <span className="cs-m-clock" onAnimationEnd={scene.onClockEnd} />
        </div>
        {!scene.reducedMotion && (
          <SceneToggle
            lang={lang}
            paused={scene.paused}
            ended={scene.ended}
            onToggle={scene.toggle}
            onReplay={scene.replay}
            className="cs-m-how__toggle"
          />
        )}
      </div>
      <figcaption key={`caption-${scene.run}`} className="cs-m-how__caption">
        <span id={titleId} className="cs-m-sr">{t.title} </span>
        <StepRail steps={t.steps} beat={BEAT} />
      </figcaption>
    </figure>
  );
}
