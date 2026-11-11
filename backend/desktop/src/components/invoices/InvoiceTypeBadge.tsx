import React from 'react';
import { InvoiceType } from '../../types/invoice';

export interface InvoiceTypeBadgeProps {
  type: InvoiceType;
}

interface TypeMeta {
  label: string;
  classes: string;
}

const typeMeta: Record<InvoiceType, TypeMeta> = {
  [InvoiceType.Factura]: {
    label: 'Factura',
    classes: 'bg-blue-100 text-blue-700',
  },
  [InvoiceType.CCF]: {
    label: 'CCF',
    classes: 'bg-cyan-100 text-cyan-700',
  },
  [InvoiceType.NotaCredito]: {
    label: 'N. Crédito',
    classes: 'bg-purple-100 text-purple-700',
  },
  [InvoiceType.SujetoExcluido]: {
    label: 'Suj. Excluido',
    classes: 'bg-amber-100 text-amber-700',
  },
  [InvoiceType.NotaDebito]: {
    label: 'N. Débito',
    classes: 'bg-red-100 text-red-700',
  },
  [InvoiceType.NotaRemision]: {
    label: 'N. Remisión',
    classes: 'bg-green-100 text-green-700',
  },
  [InvoiceType.ComprobanteLiquidacion]: {
    label: 'Liquidación',
    classes: 'bg-teal-100 text-teal-700',
  },
  [InvoiceType.FacturaExportacion]: {
    label: 'Exportación',
    classes: 'bg-indigo-100 text-indigo-700',
  },
  [InvoiceType.ComprobanteRetencion]: {
    label: 'Retención',
    classes: 'bg-orange-100 text-orange-700',
  },
  [InvoiceType.DocumentoContableLiquidacion]: {
    label: 'Doc. Contable',
    classes: 'bg-slate-100 text-slate-700',
  },
  [InvoiceType.ComprobanteDonacion]: {
    label: 'Donación',
    classes: 'bg-pink-100 text-pink-700',
  },
  [InvoiceType.EventoOperacionesEspeciales]: {
    label: 'Evento Op. Esp.',
    classes: 'bg-emerald-100 text-emerald-700',
  },
  [InvoiceType.EventoRetorno]: {
    label: 'Evento Retorno',
    classes: 'bg-lime-100 text-lime-700',
  },
};

export function InvoiceTypeBadge({ type }: InvoiceTypeBadgeProps) {
  const meta = typeMeta[type];
  if (!meta) return null;

  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap',
        meta.classes,
      ].join(' ')}
    >
      {meta.label}
    </span>
  );
}

export default InvoiceTypeBadge;
