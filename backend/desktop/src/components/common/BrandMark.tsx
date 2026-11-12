/**
 * Car Spa brand mark (vector from docs/brand, copied to src/assets/brand).
 * The default variant is for the dark sidebar/welcome backgrounds; pass
 * variant="light" on light backgrounds.
 */
import markOnDark from '@/assets/brand/car-spa-mark-ondark.svg';
import markLight from '@/assets/brand/car-spa-mark.svg';

interface BrandMarkProps {
  /** Rendered height in px (the mark is about 2.3x wider than tall). */
  size?: number;
  className?: string;
  variant?: 'ondark' | 'light';
}

export default function BrandMark({ size = 32, className = '', variant = 'ondark' }: BrandMarkProps) {
  return (
    <img
      src={variant === 'light' ? markLight : markOnDark}
      height={size}
      style={{ height: size, width: 'auto' }}
      className={className}
      alt="Car Spa"
      data-testid="brand-mark"
    />
  );
}
