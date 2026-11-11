import { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Si se provee, renderiza un botón de regreso antes del título. */
  onBack?: () => void;
  /** Texto accesible para el botón de regreso. */
  backLabel?: string;
}

export function PageHeader({ title, subtitle, actions, onBack, backLabel = 'Volver' }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div className="flex items-start gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            className="mt-1 flex h-9 w-9 items-center justify-center rounded-md border border-brand-200 bg-white text-brand-700 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-400"
            data-testid="page-header-back"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div>
          <h1 className="text-2xl font-semibold text-brand-900">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-sm text-brand-500">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-3 ml-4">
          {actions}
        </div>
      )}
    </div>
  );
}
