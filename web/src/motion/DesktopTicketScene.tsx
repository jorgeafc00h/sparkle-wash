import { useId, type CSSProperties } from "react";
import { CheckIcon, Plate, Printer } from "./art/parts";
import { DESK_COPY, type SceneLang } from "./copy";
import { SceneToggle } from "./SceneToggle";
import { StepRail } from "./StepRail";
import { useSceneController } from "./useSceneVisibility";
import "./scene-base.css";
import "./desktop-ticket-scene.css";

export interface DesktopTicketSceneProps {
  lang?: SceneLang;
  className?: string;
  style?: CSSProperties;
}

const BEAT = 3;
const TOTAL = BEAT * 3;

/**
 * The Windows register app: a work ticket OT-C1-000045 prints while offline, the sync badge goes "En vivo" when the
 * connection returns, and the job created offline syncs. 9 s, played once when first in view; the final frame
 * (ticket printed, live, synced) is also the reduced-motion frame. Lays out compactly below 520 px of width.
 */
export function DesktopTicketScene({ lang = "es", className, style }: DesktopTicketSceneProps) {
  const t = DESK_COPY[lang];
  const scene = useSceneController({ once: true, threshold: 0.35 });
  const titleId = useId();
  return (
    <figure
      {...scene.rootProps}
      aria-labelledby={titleId}
      lang={lang}
      className={["cs-m-scene", "cs-m-desk", className].filter(Boolean).join(" ")}
      style={{ "--cs-m-total": `${TOTAL}s`, ...style } as CSSProperties}
    >
      <div className="cs-m-desk__frame">
        <div key={scene.run} className="cs-m-desk__stage" aria-hidden="true">
          <div className="cs-m-desk__window cs-m-a cs-m-up cs-m-wc">
            <div className="cs-m-desk__titlebar">
              <img src="/brand/car-spa-mark-ondark.svg" alt="" width="1992" height="872" loading="lazy" decoding="async" />
              <span>{t.window}</span>
              <span className="cs-m-desk__winctl"><i /><i /><i /></span>
            </div>
            <div className="cs-m-desk__head">
              <span className="cs-m-desk__h">{t.board}</span>
              <span className="cs-m-desk__badges">
                <span className="cs-m-badge cs-m-badge--warn cs-m-desk__pending">{t.pending}</span>
                <span className="cs-m-desk__sync">
                  <span className="cs-m-badge cs-m-badge--off cs-m-desk__s-off">{t.offline}</span>
                  <span className="cs-m-badge cs-m-badge--info cs-m-desk__s-con">{t.connecting}</span>
                  <span className="cs-m-badge cs-m-badge--live cs-m-desk__s-live">
                    <span className="cs-m-desk__live-dot"><span className="cs-m-desk__pulse" /></span>
                    {t.live}
                  </span>
                </span>
              </span>
            </div>
            <div className="cs-m-desk__rows">
              <div className="cs-m-desk__row cs-m-desk__row--ticket">
                <Plate text="P903377" />
                <span className="cs-m-desk__class">{t.rows[0].vehicle}</span>
                <span className="cs-m-pill cs-m-pill--ok">{t.rows[0].status}</span>
              </div>
              <div className="cs-m-desk__row">
                <Plate text="P482913" />
                <span className="cs-m-desk__class">{t.rows[1].vehicle}</span>
                <span className="cs-m-pill cs-m-pill--muted">{t.rows[1].status}</span>
              </div>
              <div className="cs-m-desk__row cs-m-desk__row--sync">
                <Plate text="P118450" />
                <span className="cs-m-desk__class">{t.rows[2].vehicle}</span>
                <span className="cs-m-desk__upload">
                  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 12V4M4.5 7.5L8 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <span className="cs-m-desk__status">
                  <span className="cs-m-pill cs-m-pill--info cs-m-desk__st-pending">{t.pendingSync}</span>
                  <span className="cs-m-pill cs-m-pill--ok cs-m-desk__st-synced"><CheckIcon />{t.synced}</span>
                </span>
              </div>
            </div>
          </div>
          <Printer lang={lang} className="cs-m-desk__printer cs-m-a cs-m-up" />
          <span className="cs-m-clock" onAnimationEnd={scene.onClockEnd} />
        </div>
        {!scene.reducedMotion && (
          <SceneToggle
            lang={lang}
            paused={scene.paused}
            ended={scene.ended}
            onToggle={scene.toggle}
            onReplay={scene.replay}
            className="cs-m-desk__toggle"
          />
        )}
      </div>
      <figcaption key={`caption-${scene.run}`} className="cs-m-desk__caption">
        <span id={titleId} className="cs-m-sr">{t.title} </span>
        <StepRail steps={t.steps} beat={BEAT} />
      </figcaption>
    </figure>
  );
}
