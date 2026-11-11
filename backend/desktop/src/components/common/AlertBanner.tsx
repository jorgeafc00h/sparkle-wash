import React from 'react';
import { Info, AlertTriangle, XCircle, CheckCircle, X } from 'lucide-react';

export interface AlertBannerProps {
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  onDismiss?: () => void;
  action?: { label: string; onClick: () => void };
  className?: string;
}

const typeConfig: Record<
  AlertBannerProps['type'],
  {
    icon: React.ReactNode;
    containerClass: string;
    messageClass: string;
    actionClass: string;
    dismissClass: string;
  }
> = {
  info: {
    icon: <Info size={16} className="shrink-0 text-blue-500" />,
    containerClass: 'bg-blue-50 border border-blue-200',
    messageClass: 'text-blue-800',
    actionClass: 'text-blue-700 hover:text-blue-900 bg-blue-100 hover:bg-blue-200',
    dismissClass: 'text-blue-400 hover:text-blue-600',
  },
  warning: {
    icon: <AlertTriangle size={16} className="shrink-0 text-amber-500" />,
    containerClass: 'bg-amber-50 border border-amber-200',
    messageClass: 'text-amber-800',
    actionClass: 'text-amber-700 hover:text-amber-900 bg-amber-100 hover:bg-amber-200',
    dismissClass: 'text-amber-400 hover:text-amber-600',
  },
  error: {
    icon: <XCircle size={16} className="shrink-0 text-red-500" />,
    containerClass: 'bg-red-50 border border-red-200',
    messageClass: 'text-red-800',
    actionClass: 'text-red-700 hover:text-red-900 bg-red-100 hover:bg-red-200',
    dismissClass: 'text-red-400 hover:text-red-600',
  },
  success: {
    icon: <CheckCircle size={16} className="shrink-0 text-green-500" />,
    containerClass: 'bg-green-50 border border-green-200',
    messageClass: 'text-green-800',
    actionClass: 'text-green-700 hover:text-green-900 bg-green-100 hover:bg-green-200',
    dismissClass: 'text-green-400 hover:text-green-600',
  },
};

export function AlertBanner({
  type,
  message,
  onDismiss,
  action,
  className = '',
}: AlertBannerProps) {
  const config = typeConfig[type];

  return (
    <div
      role="alert"
      className={[
        'flex items-center gap-3 rounded-lg px-4 py-3',
        config.containerClass,
        className,
      ].join(' ')}
    >
      {config.icon}
      <p className={['flex-1 text-sm font-medium', config.messageClass].join(' ')}>
        {message}
      </p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={[
            'shrink-0 text-xs font-semibold px-2.5 py-1 rounded-md transition-colors',
            config.actionClass,
          ].join(' ')}
        >
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar"
          className={['shrink-0 transition-colors', config.dismissClass].join(' ')}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export default AlertBanner;
