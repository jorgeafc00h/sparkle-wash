import type { CSSProperties } from "react";
import { cx, useSceneMotion, type ExtraLocale } from "./shared";
import "./logo-intro.css";

export interface LogoIntroSceneProps {
  locale?: ExtraLocale;
  /** "dark" (default) uses the on-dark lockup for navy sections; "light" uses the full-colour lockup. */
  tone?: "dark" | "light";
  /** Rendered width of the lockup (any CSS length). Defaults to min(560px, 100%). */
  width?: string;
  className?: string;
}

/** Served from web/public/brand (copied from docs/brand). The artwork is never redrawn or recoloured here. */
const LOCKUP = { dark: "/brand/car-spa-logo-ondark.svg", light: "/brand/car-spa-logo.svg" } as const;

const LABEL: Record<ExtraLocale, string> = {
  es: "Logotipo de Car Spa, Automotive Care",
  en: "Car Spa logo, Automotive Care",
};

/* Every layer is the same lockup file, cut out with a static clip-path (see logo-intro.css for the
   coordinates) so the pieces register perfectly and the final frame is exactly the logo. */
const PARTS = ["orange", "blue", "car", "spa", "tagline", "rule-l", "rule-r"] as const;

/**
 * One-shot (≈3 s) brand intro: the orange swoosh slides in, the blue S-swoosh follows, then CAR SPA and
 * AUTOMOTIVE CARE fade up while the teal rules draw outwards, and a single light sweep crosses the lockup.
 * It starts the first time it scrolls into view; reduced motion shows the finished lockup.
 */
export function LogoIntroScene({ locale = "es", tone = "dark", width, className }: LogoIntroSceneProps) {
  const { ref, rootProps } = useSceneMotion<HTMLDivElement>();
  const src = LOCKUP[tone];
  const style = { "--cs-x-logo-src": `url("${src}")`, ...(width ? { width } : null) } as CSSProperties;
  return (
    <div
      ref={ref}
      className={cx("cs-x-scene cs-x-logo", className)}
      data-tone={tone}
      role="img"
      aria-label={LABEL[locale]}
      style={style}
      {...rootProps}
    >
      {PARTS.map((part) => (
        <img key={part} className={`cs-x-logo-part cs-x-logo-${part} cs-x-anim`} src={src} alt="" aria-hidden="true" decoding="async" draggable={false} />
      ))}
      <span className="cs-x-logo-sheen" aria-hidden="true"><span className="cs-x-logo-sheen-band cs-x-anim" /></span>
    </div>
  );
}
