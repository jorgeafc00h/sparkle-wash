import { useId, type CSSProperties } from "react";
import "./muscle-car.css";

export interface MuscleCarFrontProps {
  /** Rendered width: a number is pixels, a string is any CSS length. Height follows the 440:250 viewBox. */
  size?: number | string;
  /** Concealed headlights: "off" shows the grille closed, "on" shows the doors open and the lamps lit. */
  headlights?: "off" | "on";
  className?: string;
  style?: CSSProperties;
}

/**
 * Front view of the same coupe. Class hooks: `.cs-m-front__lamp` (one per side; inside it `.cs-m-front__door`
 * flips up about its top edge and `.cs-m-front__glow` / `.cs-m-front__lit` light up), `.cs-m-front__grille`
 * and `.cs-m-front__sweep` (a sheen clipped to the body, parked to the left).
 */
export const MUSCLE_CAR_FRONT_VIEWBOX = { width: 440, height: 250, groundY: 238 } as const;

const CENTER = 220;
/* Body silhouette seen head-on: greenhouse, hood between the fender peaks, then the blunt front face. */
const BODY =
  "M 150 36 C 146 36 143 38 141 42 L 106 92 L 98 96 L 46 106 C 38 107.6 32 110 30 115 L 28 122 L 28 202 " +
  "C 28 209 33 213 40 213 L 400 213 C 407 213 412 209 412 202 L 412 122 L 410 115 C 408 110 402 107.6 394 106 " +
  "L 342 96 L 334 92 L 299 42 C 297 38 294 36 290 36 Z";
const HOOD = "M 106 93 L 334 93 L 396 112 L 44 112 Z";
const GLASS = "M 152 46 L 288 46 C 292 46 294 48 296 51 L 326 91 L 114 91 L 144 51 C 146 48 148 46 152 46 Z";
const GRILLE = { x: 44, y: 119, w: 352, h: 50 };
const LAMPS = [
  { side: "left", door: { x: 56, w: 128 }, lamps: [86, 136] },
  { side: "right", door: { x: 256, w: 128 }, lamps: [304, 354] },
] as const;
const LAMP_Y = 144;

/** Fine vertical grille bars between x0 and x1. */
function bars(x0: number, x1: number, y0: number, y1: number) {
  const d: string[] = [];
  // Snap to one 5-unit grid so a closed headlight door is indistinguishable from the grille around it.
  for (let x = Math.ceil(x0 / 5) * 5; x <= x1; x += 5) d.push(`M ${x} ${y0} L ${x} ${y1}`);
  return d.join(" ");
}

export function MuscleCarFront({ size = "100%", headlights = "off", className, style }: MuscleCarFrontProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `${uid}-${name}`;
  const classes = ["cs-m-front", headlights === "on" ? "cs-m-front--on" : "", className ?? ""].filter(Boolean).join(" ");
  const g = GRILLE;
  return (
    <svg
      className={classes}
      viewBox={`0 0 ${MUSCLE_CAR_FRONT_VIEWBOX.width} ${MUSCLE_CAR_FRONT_VIEWBOX.height}`}
      width={typeof size === "number" ? size : undefined}
      style={{ ...(typeof size === "string" ? { width: size } : null), ...style }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id("face")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0B4DBA" />
          <stop offset=".5" stopColor="#0142A8" />
          <stop offset="1" stopColor="#012F78" />
        </linearGradient>
        <linearGradient id={id("hood")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1F59C2" />
          <stop offset="1" stopColor="#2B67D1" />
        </linearGradient>
        <linearGradient id={id("roof")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2B67D1" />
          <stop offset="1" stopColor="#0142A8" />
        </linearGradient>
        <linearGradient id={id("edge")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#012F78" stopOpacity=".9" />
          <stop offset=".14" stopColor="#012F78" stopOpacity="0" />
          <stop offset=".86" stopColor="#012F78" stopOpacity="0" />
          <stop offset="1" stopColor="#012F78" stopOpacity=".9" />
        </linearGradient>
        <linearGradient id={id("glass")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22356A" />
          <stop offset="1" stopColor="#070E22" />
        </linearGradient>
        <linearGradient id={id("chrome")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset=".5" stopColor="#C9D2E0" />
          <stop offset="1" stopColor="#7D8BA6" />
        </linearGradient>
        <linearGradient id={id("sheen")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset=".5" stopColor="#FFFFFF" stopOpacity=".5" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={id("lens")} cx=".42" cy=".38" r=".7">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset=".45" stopColor="#E8F0FF" />
          <stop offset="1" stopColor="#4D8DFF" />
        </radialGradient>
        <radialGradient id={id("glow")} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity=".9" />
          <stop offset=".35" stopColor="#E8F0FF" stopOpacity=".45" />
          <stop offset="1" stopColor="#E8F0FF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id("shadow")} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#000000" stopOpacity=".6" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
        <clipPath id={id("clip")}>
          <path d={BODY} />
        </clipPath>
        <clipPath id={id("grilleClip")}>
          <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="7" />
        </clipPath>
      </defs>

      <ellipse className="cs-m-front__shadow" cx={CENTER} cy="238" rx="214" ry="10" fill={`url(#${id("shadow")})`} />
      {/* Tyres, seen tread-on below the body. */}
      {[48, 342].map((x) => (
        <g key={x}>
          <rect x={x} y="190" width="50" height="48" rx="9" fill="#070E22" />
          <path d={`M ${x + 7} 222 L ${x + 43} 222 M ${x + 7} 230 L ${x + 43} 230`} stroke="#1B2A55" strokeWidth="2" />
        </g>
      ))}

      <g className="cs-m-front__body">
        <path d={BODY} fill={`url(#${id("face")})`} />
        <path d="M 150 36 C 146 36 143 38 141 42 L 136 49 L 304 49 L 299 42 C 297 38 294 36 290 36 Z" fill={`url(#${id("roof")})`} />
        <path d={HOOD} fill={`url(#${id("hood")})`} />
        {/* Power bulge and two orange hood stripes. */}
        <path d="M 176 112 L 186 96 L 254 96 L 264 112 Z" fill="#2B67D1" />
        <path d="M 186 96.5 L 254 96.5" stroke="#FFFFFF" strokeOpacity=".45" strokeWidth="1" />
        <path d="M 190 112 L 205 112 L 209 93 L 199 93 Z M 235 112 L 250 112 L 241 93 L 231 93 Z" fill="#FB5A00" />
        <path d={GLASS} fill={`url(#${id("glass")})`} />
        <path d="M 170 84 L 214 52 M 186 86 L 226 57" stroke="#FFFFFF" strokeOpacity=".12" strokeWidth="5" strokeLinecap="round" />
        {/* Mirrors. */}
        <path d="M 92 90 C 86 90 82 86 84 82 L 96 80 L 104 90 Z M 348 90 C 354 90 358 86 356 82 L 344 80 L 336 90 Z" fill="#012F78" />
        {/* Rounded flanks and the white specular line along the hood edge. */}
        <path d="M 28 112 L 412 112 L 412 213 L 28 213 Z" fill={`url(#${id("edge")})`} />
        <path d="M 28 196 L 100 196 C 104 196 106 199 106 202 L 106 213 L 40 213 C 33 213 28 209 28 202 Z M 412 196 L 340 196 C 336 196 334 199 334 202 L 334 213 L 400 213 C 407 213 412 209 412 202 Z" fill="#012F78" opacity=".8" />
        <path d="M 40 112.5 L 400 112.5" stroke="#FFFFFF" strokeOpacity=".75" strokeWidth="1.8" strokeLinecap="round" />

        {/* Full-width blacked-out grille: chrome surround, fine vertical bars, centre divider. */}
        <g className="cs-m-front__grille">
          <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="7" fill="#060B1C" />
          <path d={bars(g.x + 4, g.x + g.w - 4, g.y + 3, g.y + g.h - 3)} stroke="#1B2A55" strokeWidth="1.6" />
          <path d={`M ${g.x + 4} ${g.y + g.h / 2} L ${g.x + g.w - 4} ${g.y + g.h / 2}`} stroke="#13234A" strokeWidth="1" />
          <g clipPath={`url(#${id("grilleClip")})`}>
            {LAMPS.map((lamp) => (
              <g key={lamp.side} className={`cs-m-front__lamp cs-m-front__lamp--${lamp.side}`}>
                <ellipse className="cs-m-front__glow" cx={lamp.door.x + lamp.door.w / 2} cy={LAMP_Y} rx="78" ry="34" fill={`url(#${id("glow")})`} />
                {lamp.lamps.map((cx) => (
                  <g key={cx}>
                    <circle cx={cx} cy={LAMP_Y} r="16" fill="#0B1530" stroke={`url(#${id("chrome")})`} strokeWidth="2.4" />
                    <circle cx={cx} cy={LAMP_Y} r="12.5" fill="#22356A" />
                    <circle className="cs-m-front__lit" cx={cx} cy={LAMP_Y} r="12.5" fill={`url(#${id("lens")})`} />
                  </g>
                ))}
                {/* The door is a section of grille that flips up about its top edge. */}
                <g className="cs-m-front__door">
                  <rect x={lamp.door.x} y={g.y + 2} width={lamp.door.w} height={g.h - 6} fill="#060B1C" />
                  <path d={bars(lamp.door.x, lamp.door.x + lamp.door.w, g.y + 3, g.y + g.h - 5)} stroke="#1B2A55" strokeWidth="1.6" />
                  <path d={`M ${lamp.door.x} ${g.y + g.h / 2 - 2} L ${lamp.door.x + lamp.door.w} ${g.y + g.h / 2 - 2}`} stroke="#13234A" strokeWidth="1" />
                </g>
              </g>
            ))}
          </g>
          <rect x={CENTER - 9} y={g.y} width="18" height={g.h} fill={`url(#${id("face")})`} />
          <path d={`M ${CENTER - 9} ${g.y + 1} L ${CENTER - 9} ${g.y + g.h - 1} M ${CENTER + 9} ${g.y + 1} L ${CENTER + 9} ${g.y + g.h - 1}`} stroke="#4D8DFF" strokeOpacity=".5" strokeWidth="1" />
          <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="7" fill="none" stroke={`url(#${id("chrome")})`} strokeWidth="2.2" />
        </g>

        {/* Thin chrome bumper under the grille, valance with orange parking lamps and a low intake. */}
        <path d="M 34 176 C 120 173.5 320 173.5 406 176 L 406 182 C 320 179.5 120 179.5 34 182 Z" fill={`url(#${id("chrome")})`} />
        <rect x="62" y="186" width="38" height="7" rx="3.5" fill="#FF7A2E" />
        <rect x="340" y="186" width="38" height="7" rx="3.5" fill="#FF7A2E" />
        <rect x="160" y="190" width="120" height="9" rx="4.5" fill="#060B1C" />
        <path d="M 166 194.5 L 274 194.5" stroke="#1B2A55" strokeWidth="1" />

        <g clipPath={`url(#${id("clip")})`}>
          <g className="cs-m-front__sweep">
            <path d="M -150 20 L -90 20 L -150 226 L -210 226 Z" fill={`url(#${id("sheen")})`} />
          </g>
        </g>
      </g>
    </svg>
  );
}
