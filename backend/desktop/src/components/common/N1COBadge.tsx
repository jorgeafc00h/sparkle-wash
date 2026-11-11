import { ShieldCheck } from 'lucide-react';

interface N1COBadgeProps {
  variant?: 'inline' | 'block';
  className?: string;
}

/**
 * Attribution + trust badge for N1CO payment processing.
 *
 * Two layouts:
 *   - `inline` (default): horizontal pill — "Pagos seguros por [N1CO]"
 *   - `block`: vertical card — explains what N1CO is, suitable for the
 *     subscription modal where users first see the payment option.
 *
 * N1CO's official SVG (white-on-transparent) is bundled at /n1co-logo.svg.
 * It's designed for dark backgrounds, so the badge uses N1CO purple
 * (#8300E9) as background. The brand color comes from n1co.com's CSS.
 */
export function N1COBadge({ variant = 'inline', className = '' }: N1COBadgeProps) {
  if (variant === 'block') {
    return (
      <div
        data-testid="n1co-badge-block"
        className={`rounded-xl border border-brand-200 bg-white p-4 flex gap-3 items-center ${className}`}
      >
        <div
          className="flex-shrink-0 rounded-lg px-3 py-2 flex items-center justify-center"
          style={{ backgroundColor: '#8300E9' }}
        >
          <img
            src="/n1co-logo.svg"
            alt="N1CO"
            className="h-5 w-auto"
            loading="lazy"
          />
        </div>
        <div className="text-xs text-brand-600 leading-relaxed">
          Tus pagos se procesan de forma segura por{' '}
          <span className="font-semibold text-brand-800">N1CO</span>,
          la pasarela de pagos de El Salvador. No almacenamos los datos
          de tu tarjeta en este dispositivo.
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="n1co-badge-inline"
      className={`flex items-center gap-2 text-xs text-brand-500 ${className}`}
    >
      <ShieldCheck size={14} className="text-green-600" />
      <span>Pagos procesados de forma segura por</span>
      <span
        className="inline-flex items-center rounded px-1.5 py-0.5"
        style={{ backgroundColor: '#8300E9' }}
      >
        <img
          src="/n1co-logo.svg"
          alt="N1CO"
          className="h-3 w-auto"
          loading="lazy"
        />
      </span>
    </div>
  );
}
