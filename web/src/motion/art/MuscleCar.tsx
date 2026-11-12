import { useId, type CSSProperties } from "react";
import "./muscle-car.css";

export interface MuscleCarProps {
  /** Rendered width: a number is pixels, a string is any CSS length ("100%", "18rem"). Height follows the viewBox. */
  size?: number | string;
  /** Spin both wheels continuously (a car that is driving). Scenes can also animate `.cs-m-car__spin` themselves. */
  wheelsTurning?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Side profile, facing right, ground at `groundY`. Class hooks for scenes: `.cs-m-car__body` (stance and
 * suspension), `.cs-m-car__spin` (each wheel; transform-box fill-box, so it turns about its own centre),
 * `.cs-m-car__sweep` (a sheen clipped to the paint, parked left of the car; translateX ≈ 860 carries it across)
 * and `.cs-m-car__shadow`.
 */
export const MUSCLE_CAR_VIEWBOX = { width: 600, height: 190, groundY: 182 } as const;
export const MUSCLE_CAR_WHEELS = [{ x: 150, y: 146, r: 36 }, { x: 476, y: 146, r: 36 }] as const;

const ROCKER_Y = 164;
const ARCH_R = 42;
const [REAR, FRONT] = MUSCLE_CAR_WHEELS;
const r1 = (n: number) => Math.round(n * 10) / 10;
const halfChord = (r: number, cy: number) => Math.sqrt(r ** 2 - (ROCKER_Y - cy) ** 2);
const archPoints = (w: { x: number; y: number }, r: number) => {
  const dx = halfChord(r, w.y);
  return { left: r1(w.x - dx), right: r1(w.x + dx), r };
};
const rearArch = archPoints(REAR, ARCH_R);
const frontArch = archPoints(FRONT, ARCH_R);

/* Late-sixties American fastback coupe, drawn from scratch: blunt near-vertical nose, long flat hood, raked
   windshield, flat roof flowing into tunnel-back sail panels, a short deck that ends in a ducktail lip. */
const BODY = [
  "M 46 164",
  "C 36 164 30 160 28 154", // rear valance
  "L 27 146",
  "L 26 108", // tail panel
  "C 26 103 26 100 25 97", // tumblehome into the lip
  "L 23 90.5", // ducktail kicks up
  "C 30 90 40 92 52 93",
  "L 84 93", // short deck
  "C 112 92 138 86 160 76", // sail panel
  "C 184 64 206 56 232 53",
  "C 252 51 300 49.5 322 50", // flat roof
  "C 334 50.5 342 55 350 63",
  "L 374 88", // raked windshield
  "L 402 88.6", // cowl
  "C 460 89 520 89 566 90", // long flat hood
  "C 571 90 574 91 575 93",
  "L 577 136", // blunt front
  "C 578 141 577 146 574 150",
  "C 570 158 564 162 554 164",
  `L ${frontArch.right} ${ROCKER_Y}`,
  `A ${ARCH_R} ${ARCH_R} 0 1 0 ${frontArch.left} ${ROCKER_Y}`,
  `L ${rearArch.right} ${ROCKER_Y}`,
  `A ${ARCH_R} ${ARCH_R} 0 1 0 ${rearArch.left} ${ROCKER_Y}`,
  "Z",
].join(" ");

const well = (a: { left: number; right: number; r: number }) =>
  `M ${a.left} ${ROCKER_Y} A ${a.r} ${a.r} 0 1 1 ${a.right} ${ROCKER_Y} Z `;

/** Light along the top of each arch lip, from about 10 to 2 o'clock. */
const lipEdge = (w: { x: number; y: number }) => {
  const r = ARCH_R + 3;
  const p = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${r1(w.x + r * Math.cos(a))} ${r1(w.y + r * Math.sin(a))}`;
  };
  return `M ${p(-155)} A ${r} ${r} 0 0 1 ${p(-25)} `;
};

/* Side glass: door glass and a small quarter light; the thick sail panel hides the tunnel-back rear window. */
const GLASS = "M 240 89 C 242 76 246 65 252 60 C 255 58 258 57 263 57 L 318 56 C 327 56 334 60 340 66 L 362 89 Z";
/* Beltline highlight: level along the front fender and door, then the coke-bottle kick over the rear wheel. */
const BELTLINE = "M 568 93.5 C 500 93 400 93.5 330 95 C 284 96 250 97 226 95.5 C 204 94 186 89 166 88.5 C 136 88 112 96 84 97.5 L 36 98.5";

function Wheel({ x, y, r, metal }: { x: number; y: number; r: number; metal: string }) {
  return (
    <g className="cs-m-car__wheel" transform={`translate(${x} ${y})`}>
      <circle r={r} fill="#070E22" />
      <circle r={r - 4} fill="none" stroke="#1B2A55" strokeWidth="1.5" />
      <circle r={23} fill="#0B1530" />
      <g className="cs-m-car__spin">
        {/* Deep dish: polished lip, dark barrel, five tapered spokes set back inside it. */}
        <circle r={25} fill="none" stroke={`url(#${metal})`} strokeWidth="3.4" />
        <circle r={21} fill="none" stroke="#2A3F72" strokeWidth="1" />
        {[0, 72, 144, 216, 288].map((a) => (
          <path
            key={a}
            d="M -4.2 -7 L -6.6 -20.5 Q 0 -22.6 6.6 -20.5 L 4.2 -7 Z"
            fill={`url(#${metal})`}
            stroke="#4A5468"
            strokeWidth=".6"
            transform={`rotate(${a})`}
          />
        ))}
        <circle r={8} fill="#D5DDEA" />
        {[0, 72, 144, 216, 288].map((a) => (
          <circle key={a} r={1} cy={-5.2} fill="#4A5468" transform={`rotate(${a + 36})`} />
        ))}
        <circle r={3} fill="#FB5A00" />
      </g>
    </g>
  );
}

/** An original late-sixties American muscle coupe in the Car Spa livery. Decorative, so always aria-hidden. */
export function MuscleCar({ size = "100%", wheelsTurning = false, className, style }: MuscleCarProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `${uid}-${name}`;
  const classes = ["cs-m-car", wheelsTurning ? "cs-m-car--turning" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <svg
      className={classes}
      viewBox={`0 0 ${MUSCLE_CAR_VIEWBOX.width} ${MUSCLE_CAR_VIEWBOX.height}`}
      width={typeof size === "number" ? size : undefined}
      style={{ ...(typeof size === "string" ? { width: size } : null), ...style }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id("paint")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2B67D1" />
          <stop offset=".45" stopColor="#0142A8" />
          <stop offset="1" stopColor="#012F78" />
        </linearGradient>
        <linearGradient id={id("glass")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22356A" />
          <stop offset=".55" stopColor="#0B1530" />
          <stop offset="1" stopColor="#060B1C" />
        </linearGradient>
        <linearGradient id={id("sheen")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset=".5" stopColor="#FFFFFF" stopOpacity=".6" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("metal")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset=".55" stopColor="#C9D2E0" />
          <stop offset="1" stopColor="#6B7A96" />
        </linearGradient>
        <radialGradient id={id("shadow")} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#000000" stopOpacity=".6" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
        <clipPath id={id("clip")}>
          <path d={BODY} />
        </clipPath>
      </defs>

      <ellipse className="cs-m-car__shadow" cx="300" cy="182" rx="276" ry="7" fill={`url(#${id("shadow")})`} />

      <g className="cs-m-car__body">
        <path d={well(rearArch) + well(frontArch)} fill="#050A18" />
        <path d={BODY} fill={`url(#${id("paint")})`} />
        <g clipPath={`url(#${id("clip")})`}>
          {/* Lower body in shade, a soft crease above it, and the arch lips catching light. */}
          <path d="M 0 146 L 600 146 L 600 170 L 0 170 Z" fill="#012F78" opacity=".6" />
          <path d="M 34 132 C 200 129.5 420 129.5 572 132" stroke="#4D8DFF" strokeOpacity=".4" strokeWidth="1.3" fill="none" />
          <path d={lipEdge(REAR) + lipEdge(FRONT)} stroke="#4D8DFF" strokeOpacity=".6" strokeWidth="1.4" fill="none" />
          {/* Door scallop: a long recess with light on its upper edge. */}
          <path d="M 278 113 C 320 104 384 103 432 107 C 396 111 334 115 278 113 Z" fill="#012F78" opacity=".7" />
          <path d="M 280 112.4 C 322 103.6 386 102.6 432 106.8" stroke="#4D8DFF" strokeOpacity=".55" strokeWidth="1" fill="none" />
          {/* Two orange stripes wrapping the tail. */}
          <path d="M 53 88 L 63 88 L 67 170 L 57 170 Z M 71 88 L 81 88 L 85 170 L 75 170 Z" fill="#FB5A00" />
          {/* Light sweep, parked left of the car until a scene moves it. */}
          <g className="cs-m-car__sweep">
            <path d="M -180 0 L -110 0 L -170 190 L -240 190 Z" fill={`url(#${id("sheen")})`} />
          </g>
        </g>
        {/* Power bulge on the hood. */}
        <path d="M 410 88.7 C 414 85.4 418 84.4 426 84.4 L 520 84.8 C 527 84.8 531 86.2 535 89 Z" fill={`url(#${id("paint")})`} />
        <path d="M 424 84.9 L 521 85.3" stroke="#FFFFFF" strokeOpacity=".4" strokeWidth="1" />
        {/* Recessed full-width grille seen edge-on, and the thin chrome bumpers. */}
        <path d="M 570.5 96 L 575.6 96 L 576.6 132 L 571.5 132 Z" fill="#070E22" />
        <path d="M 572.6 98 L 573.4 130" stroke="#2A3F72" strokeWidth=".8" />
        <path d="M538 136.2 578 135.4C581 135.4 582.4 136.8 582.4 138.4S581 141.2 578 141.2L538 141.8ZM22 140C22 138.6 23.2 138 25 138L64 138.6V143.6L25 144.2C23.2 144.2 22 143.2 22 141.8Z" fill={`url(#${id("metal")})`} />
        <path d="M 192 160.5 L 434 160.5" stroke="#B7C3D9" strokeOpacity=".45" strokeWidth="1.2" strokeLinecap="round" />
        {/* Glass, quarter-light divider, door seams, handle, mirror. */}
        <path d={GLASS} fill={`url(#${id("glass")})`} />
        <path d="M 274 80 C 290 68 312 61 334 60" stroke="#FFFFFF" strokeOpacity=".13" strokeWidth="6" fill="none" strokeLinecap="round" />
        <path d="M 266 57 L 272 56.8 L 270.6 89 L 264.6 89 Z" fill="#012F78" />
        <path d="M410 92C412 116 412 140 408 158M268 92C266 116 266 140 268 158" stroke="#012F78" strokeWidth="1.3" fill="none" />
        <path d="M277.5 101H288.5A1.5 1.5 0 0 1 288.5 104H277.5A1.5 1.5 0 0 1 277.5 101ZM352 89C350 82 356 78 364 80L366 89Z" fill="#0B1530" />
        {/* White specular beltline with the coke-bottle kick, and the roof gloss. */}
        <path d={BELTLINE} stroke="#FFFFFF" strokeOpacity=".85" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M 120 89 C 150 82 190 62 232 55.5 C 256 52.5 300 52 322 52.6" stroke="#FFFFFF" strokeOpacity=".25" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {/* Orange tail-light bar seen edge-on, side markers. */}
        <path d="M 24.6 101.5 L 28.6 101 L 28.6 128.5 L 25.2 129 Z" fill="#FB5A00" />
        <path d="M40 113H47A2 2 0 0 1 47 117H40A2 2 0 0 1 40 113ZM555 113H563A2 2 0 0 1 563 117H555A2 2 0 0 1 555 113Z" fill="#FF7A2E" />
      </g>

      <Wheel {...REAR} metal={id("metal")} />
      <Wheel {...FRONT} metal={id("metal")} />
    </svg>
  );
}
