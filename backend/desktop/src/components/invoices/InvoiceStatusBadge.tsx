import React from 'react';
import { InvoiceStatus } from '../../types/invoice';
import { XCircle, RefreshCw, AlertCircle } from 'lucide-react';

export interface InvoiceStatusBadgeProps {
  status: InvoiceStatus;
  onStatusClick?: () => void;
}

interface StatusMeta {
  label: string;
  classes: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  icon?: React.ReactNode;
}

const statusMeta: Record<InvoiceStatus, StatusMeta> = {
  [InvoiceStatus.Nueva]: {
    label: 'Nueva',
    classes: 'bg-amber-100 text-amber-700',
    urgency: 'medium',
  },
  [InvoiceStatus.Sincronizando]: {
    label: 'Sincronizando',
    classes: 'bg-blue-100 text-blue-700',
    urgency: 'high',
    icon: <RefreshCw size={10} className="animate-spin ml-1" />,
  },
  [InvoiceStatus.Completada]: {
    label: 'Completada',
    classes: 'bg-green-100 text-green-700',
    urgency: 'low',
  },
  [InvoiceStatus.Anulada]: {
    label: 'Anulada',
    classes: 'bg-red-100 text-red-700',
    urgency: 'low',
  },
  [InvoiceStatus.Modificada]: {
    label: 'Modificada',
    classes: 'bg-purple-100 text-purple-700',
    urgency: 'high',
    icon: <AlertCircle size={10} className="ml-1" />,
  },
  [InvoiceStatus.ErrorEnvio]: {
    label: 'Error',
    classes: 'bg-red-100 text-red-700',
    urgency: 'critical',
    icon: <XCircle size={10} className="ml-1" />,
  },
  [InvoiceStatus.Contingencia]: {
    label: 'Contingencia',
    classes: 'bg-orange-100 text-orange-700',
    urgency: 'medium',
    icon: <AlertCircle size={10} className="ml-1" />,
  },
};

export function InvoiceStatusBadge({ status, onStatusClick }: InvoiceStatusBadgeProps) {
  const meta = statusMeta[status];
  if (!meta) return null;

  return (
    <span
      onClick={onStatusClick}
      className={[
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap',
        meta.classes,
        // Urgency-based visual effects
        meta.urgency === 'critical' ? 'animate-pulse ring-2 ring-red-300 ring-opacity-50' : '',
        meta.urgency === 'high' ? 'ring-2 ring-yellow-300 ring-opacity-50' : '',
        meta.urgency === 'medium' ? 'ring-2 ring-orange-300 ring-opacity-30' : '',
      ].filter(Boolean).join(' ')}
      title={meta.label}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

export default InvoiceStatusBadge;
