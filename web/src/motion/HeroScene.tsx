import { useId, type CSSProperties } from "react";
import { MuscleCar } from "./art/MuscleCar";
import { MuscleCarFront } from "./art/MuscleCarFront";
import { HERO_COPY, type SceneLang } from "./copy";
import { SceneToggle } from "./SceneToggle";
import { useSceneController } from "./useSceneVisibility";
import "./scene-base.css";
import "./hero-scene.css";

export interface HeroSceneProps {
  lang?: SceneLang;
  /** Keep the caption for screen readers only (the hero headline may already say it). */
  hideCaption?: boolean;
  className?: string;
  style?: CSSProperties;
}

/* Foam bubbles around the lower body: position (%), size (cqi) and start offset inside the 8 s loop. */
const BUBBLES = [
  { x: 16, y: 22, s: 2.4, d: 1.5 }, { x: 25, y: 26, s: 3.4, d: 1.75 }, { x: 31, y: 21, s: 1.8, d: 2.05 },
  { x: 69, y: 24, s: 3, d: 1.65 }, { x: 77, y: 21, s: 2, d: 2 }, { x: 84, y: 27, s: 2.6, d: 2.4 },
  { x: 20, y: 22, s: 2.8, d: 5.3 }, { x: 27, y: 25, s: 1.9, d: 5.55 }, { x: 44, y: 22, s: 2.3, d: 5.8 },
  { x: 72, y: 22, s: 3.2, d: 5.45 }, { x: 79, y: 26, s: 2, d: 5.75 }, { x: 58, y: 23, s: 2.5, d: 6.05 },
];

/**
 * "Brillo": the coupe faces the visitor, its concealed headlights open and glow, a sheen crosses the hood,
 * then it cuts to the side profile rolling in, settling and rolling off. 8 s loop, pausable (WCAG 2.2.2),
 * paused offscreen; reduced motion shows the front view with the lamps on.
 */
export function HeroScene({ lang = "es", hideCaption = false, className, style }: HeroSceneProps) {
  const t = HERO_COPY[lang];
  const scene = useSceneController({ threshold: 0.2 });
  const captionId = useId();
  return (
    <figure
      {...scene.rootProps}
      aria-labelledby={captionId}
      lang={lang}
      className={["cs-m-scene", "cs-m-hero", className].filter(Boolean).join(" ")}
      style={style}
    >
      <div className="cs-m-hero__stage" aria-hidden="true">
        <div className="cs-m-hero__pool" />
        <div className="cs-m-hero__floor" />
        <div className="cs-m-hero__brand">
          <img className="cs-m-hero__mark" src="/brand/car-spa-mark-ondark.svg" alt="" width="1992" height="872" decoding="async" />
          <span className="cs-m-hero__glint"><span /></span>
        </div>
        <div className="cs-m-hero__front cs-m-wc">
          <MuscleCarFront headlights="on" />
        </div>
        <div className="cs-m-hero__side cs-m-wc">
          <MuscleCar />
        </div>
        <div className="cs-m-hero__foam">
          {BUBBLES.map((b, i) => (
            <span
              key={i}
              className="cs-m-hero__bubble"
              style={{ left: `${b.x}%`, "--y": `${b.y}%`, "--s": `${b.s}cqi`, "--d": `${b.d}s` } as CSSProperties}
            />
          ))}
        </div>
      </div>
      {!scene.reducedMotion && (
        <SceneToggle lang={lang} paused={scene.paused} onToggle={scene.toggle} className="cs-m-hero__toggle" />
      )}
      <figcaption id={captionId} className={hideCaption ? "cs-m-sr" : "cs-m-hero__caption"}>
        {t.caption}
        <span className="cs-m-sr"> {t.description}</span>
      </figcaption>
    </figure>
  );
}
