/**
 * SparkleWash brand mark — the water drop of the app icon (public/icon.*,
 * public/favicon.svg and the iOS AppIcon), drawn inline so it stays crisp at
 * any size and ships no raster.
 */
interface BrandMarkProps {
  /** Rendered width/height in px. */
  size?: number;
  className?: string;
}

export default function BrandMark({ size = 32, className = '' }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="SparkleWash"
      data-testid="brand-mark"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="8" fill="#0b1220" />
      <path d="M16 5c4 6 7 9.5 7 13a7 7 0 0 1-14 0c0-3.5 3-7 7-13z" fill="#38bdf8" />
      <path d="M13 19a3 3 0 0 0 3 3" stroke="#e0f2fe" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
