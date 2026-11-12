import { useId, type CSSProperties } from "react";
// W2's car, imported from its own module: ../index re-exports W2's three scenes and their CSS, which would
// more than double this scene's chunk (51 KB instead of 24 KB minified).
import { MuscleCar, MUSCLE_CAR_VIEWBOX, MUSCLE_CAR_WHEELS } from "../art/MuscleCar";
import { cx, PauseButton, useSceneMotion, type ExtraLocale } from "./shared";
import "./polish.css";

export interface PolishSceneProps {
  locale?: ExtraLocale;
  className?: string;
}

const TEXT = {
  es: {
    steps: ["Lavado", "Pulido", "Brillo de showroom"],
    list: "Etapas del detallado",
    caption: "El costado de un muscle car pasa de opaco y empolvado a un brillo profundo: lavado con espuma, pulido a máquina y brillo de showroom.",
  },
  en: {
    steps: ["Wash", "Polish", "Showroom shine"],
    list: "Detailing stages",
    caption: "A muscle car's side goes from dull and dusty to deep gloss: foam wash, machine polish and a showroom shine.",
  },
} as const;

/* The car box follows the art's own viewBox, so the overlays (pad, sparkles, windows) stay registered. */
const CAR_BOX: CSSProperties = { aspectRatio: `${MUSCLE_CAR_VIEWBOX.width} / ${MUSCLE_CAR_VIEWBOX.height}` };

/* The pad works the door: halfway between the wheels, a little above the wheel centres (viewBox units). */
const [REAR, FRONT] = MUSCLE_CAR_WHEELS;
const PAD_AT = {
  left: `${(((REAR.x + FRONT.x) / 2) / MUSCLE_CAR_VIEWBOX.width) * 100}%`,
  top: `${((REAR.y - 24) / MUSCLE_CAR_VIEWBOX.height) * 100}%`,
};

/* Foam: overlapping soft circles merge into one scalloped cloud ([x %, y %, diameter %] of the cluster width);
   a few open rings on its edge read as bubbles. */
const FOAM: Array<[number, number, number]> = [
  [52, 4, 46], [32, 12, 52], [66, 20, 50], [40, 28, 62], [62, 38, 56], [34, 46, 58], [60, 55, 60],
  [38, 64, 56], [64, 72, 52], [42, 80, 58], [58, 90, 50], [36, 96, 40], [20, 30, 34], [80, 48, 32], [18, 74, 30],
];
const BUBBLES: Array<[number, number, number]> = [[12, 14, 14], [86, 10, 12], [92, 32, 10], [6, 54, 12], [90, 70, 14], [10, 90, 10], [78, 98, 12], [96, 88, 8]];
/* Sparkles on the clear coat once it shines: [x %, y %, delay s]. */
const SPARKS: Array<[number, number, number]> = [[27, 52, 0], [61, 55, .35], [84, 54, .7], [45, 63, 1.05]];

/**
 * Before/after detailing loop (12 s): a dusty, dull muscle-car side; a foam pass lifts the dust, a polishing pad
 * works the door in circles, then a wipe reveals deep gloss with a light sweep, reflections and sparkles.
 * Captions are real text. Paused offscreen, "Pausar animación" control, reduced motion shows the glossy result.
 */
export function PolishScene({ locale = "es", className }: PolishSceneProps) {
  const t = TEXT[locale];
  const { ref, rootProps, reduced, paused, togglePaused } = useSceneMotion<HTMLElement>();
  const dustId = `cs-x-dust-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <figure ref={ref} className={cx("cs-x-scene cs-x-polish", className)} {...rootProps}>
      <div className="cs-x-p-stage">
        <svg className="cs-x-p-defs" width="0" height="0" aria-hidden="true" focusable="false">
          <filter id={dustId} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
            {/* Road film and specks, kept inside the car's own silhouette (SourceAlpha). */}
            <feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves={2} seed={7} result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 .86  0 0 0 0 .8  0 0 0 0 .7  0 0 0 15 -10.4" result="specks" />
            <feFlood floodColor="#8B7F6E" floodOpacity=".24" result="haze" />
            <feMerge result="dust"><feMergeNode in="haze" /><feMergeNode in="specks" /></feMerge>
            <feComposite in="dust" in2="SourceAlpha" operator="in" />
          </filter>
        </svg>

        <div className="cs-x-p-car" style={CAR_BOX} aria-hidden="true">
          <MuscleCar className="cs-x-p-gloss" />

          <div className="cs-x-p-refl cs-x-anim">
            <div className="cs-x-p-refl-in cs-x-anim"><MuscleCar className="cs-x-p-white" /></div>
          </div>

          <div className="cs-x-p-win cs-x-p-win--matte cs-x-anim">
            <div className="cs-x-p-win-in cs-x-anim"><MuscleCar className="cs-x-p-dull" /></div>
          </div>
          <div className="cs-x-p-win cs-x-p-win--dust cs-x-anim">
            <div className="cs-x-p-win-in cs-x-anim"><MuscleCar className="cs-x-p-dust" style={{ filter: `url(#${dustId})` }} /></div>
          </div>

          <div className="cs-x-p-track cs-x-p-track--foam cs-x-anim">
            <div className="cs-x-p-foam cs-x-anim">
              {FOAM.map(([x, y, d], i) => (
                <span key={i} style={{ left: `${x}%`, top: `${y}%`, width: `${d}%` }} />
              ))}
              {BUBBLES.map(([x, y, d], i) => (
                <b key={i} style={{ left: `${x}%`, top: `${y}%`, width: `${d}%` }} />
              ))}
            </div>
          </div>
          <div className="cs-x-p-pad-at" style={PAD_AT}>
            <span className="cs-x-p-swirl cs-x-anim" />
            <div className="cs-x-p-pad-move cs-x-anim">
              <div className="cs-x-p-orbit cs-x-anim">
                <span className="cs-x-p-pad cs-x-anim" />
              </div>
            </div>
          </div>

          {/* The wipe's light edge rides the matte layer's edge and only lights the car's own silhouette. */}
          <div className="cs-x-p-edge cs-x-anim">
            <div className="cs-x-p-edge-in cs-x-anim"><MuscleCar className="cs-x-p-white" /></div>
          </div>

          {SPARKS.map(([x, y, d], i) => (
            <svg key={i} className="cs-x-p-spark cs-x-anim" viewBox="-10 -10 20 20" style={{ left: `${x}%`, top: `${y}%`, "--d": `${d}s` } as CSSProperties} aria-hidden="true" focusable="false">
              <path d="M0-10C.8-2.6 2.6-.8 10 0 2.6.8.8 2.6 0 10-.8 2.6-2.6.8-10 0-2.6-.8-.8-2.6 0-10z" fill="#fff" />
            </svg>
          ))}
        </div>

        {!reduced && <PauseButton paused={paused} onToggle={togglePaused} locale={locale} />}
      </div>

      <figcaption className="cs-x-p-caption">
        <span className="cs-x-sr">{t.caption}</span>
        <ol aria-label={t.list}>
          {t.steps.map((step, i) => (
            <li key={step} style={{ "--i": i } as CSSProperties}>
              <span className="cs-x-p-bar" aria-hidden="true"><span className="cs-x-p-fill cs-x-anim" /></span>
              <span className="cs-x-p-num" aria-hidden="true">{`0${i + 1}`}</span>
              <span className="cs-x-p-step">{step}</span>
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
