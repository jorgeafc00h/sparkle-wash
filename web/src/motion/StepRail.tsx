import type { CSSProperties } from "react";
import "./step-rail.css";

export interface StepRailProps {
  steps: readonly string[];
  /** Seconds each step lasts on the timeline; step i starts at i × beat. */
  beat: number;
  className?: string;
}

/**
 * The scene's captions as a real ordered list. Every caption is always rendered and readable; while the timeline
 * plays, each step's number lights up and its bar fills during its beat (transform/opacity only).
 */
export function StepRail({ steps, beat, className }: StepRailProps) {
  return (
    <ol className={["cs-m-rail", className].filter(Boolean).join(" ")}>
      {steps.map((text, i) => (
        <li key={i} className="cs-m-rail__item" style={{ "--t0": `${i * beat}s`, "--dur": `${beat}s` } as CSSProperties}>
          <span className="cs-m-rail__num" data-n={i + 1} aria-hidden="true">{i + 1}</span>
          <span className="cs-m-rail__text">{text}</span>
          <span className="cs-m-rail__bar" aria-hidden="true">
            <span className="cs-m-rail__fill" />
          </span>
        </li>
      ))}
    </ol>
  );
}
