import * as React from 'react';
import { InvoiceDetail, InvoiceType } from '../../types/invoice';
import { carriesIva, computeTotals } from '../../utils/invoiceTotals';

function fmt(n: number) {
  return `$${n.toFixed(2)}`;
}

export interface InvoiceTotalsProps {
  items: InvoiceDetail[];
  invoiceType: InvoiceType;
  customerHasRetention?: boolean;
  /** FSE: withhold 10% renta (absent = true). */
  applyRentaRetention?: boolean;
  /** IVA percepción 1% decision (ivaPerceptionApplies / stored on the invoice). */
  applyIvaPerception?: boolean;
}

export function InvoiceTotals({
  items,
  invoiceType,
  customerHasRetention,
  applyRentaRetention,
  applyIvaPerception,
}: InvoiceTotalsProps) {
  // Same function the slice stores and the DTE mapper uses, so the displayed
  // figures always equal the stored ones and the document Hacienda receives.
  const {
    subTotal,
    tax,
    ivaRete1,
    ivaPerci1 = 0,
    reteRenta,
    totalPagar,
    totalDiscount = 0,
    totalExenta = 0,
    totalNoSuj = 0,
  } = computeTotals(items, invoiceType, customerHasRetention, { applyRentaRetention, applyIvaPerception });
  const withIva = carriesIva(invoiceType);

  return (
    <div className="bg-brand-50 rounded-lg p-4 space-y-2 text-sm">
      <div className="flex justify-between text-brand-600" data-testid="inv-totals-subtotal">
        <span>
          {!withIva
            ? 'Subtotal'
            : totalExenta > 0 || totalNoSuj > 0
              ? 'Subtotal gravado (sin IVA)'
              : 'Subtotal (sin IVA)'}
        </span>
        <span>{fmt(subTotal)}</span>
      </div>
      {totalExenta > 0 && (
        <div className="flex justify-between text-brand-600" data-testid="inv-totals-exenta">
          <span>Ventas exentas</span>
          <span>{fmt(totalExenta)}</span>
        </div>
      )}
      {totalNoSuj > 0 && (
        <div className="flex justify-between text-brand-600" data-testid="inv-totals-nosujeta">
          <span>Ventas no sujetas</span>
          <span>{fmt(totalNoSuj)}</span>
        </div>
      )}
      {totalDiscount > 0 && (
        <div className="flex justify-between text-brand-600" data-testid="inv-totals-discount">
          <span>Descuento</span>
          <span>-{fmt(totalDiscount)}</span>
        </div>
      )}
      {withIva && (
        <div className="flex justify-between text-brand-600" data-testid="inv-totals-iva">
          <span>IVA (13%)</span>
          <span>{fmt(tax)}</span>
        </div>
      )}
      {ivaPerci1 > 0 && (
        <div className="flex justify-between text-brand-600" data-testid="inv-totals-percepcion-iva">
          <span>Percepción IVA (1%)</span>
          <span>+{fmt(ivaPerci1)}</span>
        </div>
      )}
      {ivaRete1 > 0 && (
        <div className="flex justify-between text-brand-600" data-testid="inv-totals-retencion-iva">
          <span>Retención IVA (1%)</span>
          <span>-{fmt(ivaRete1)}</span>
        </div>
      )}
      {invoiceType === InvoiceType.SujetoExcluido && applyRentaRetention !== false && (
        <div className="flex justify-between text-brand-600" data-testid="inv-totals-retencion-renta">
          <span>Retención Renta (10%)</span>
          <span>-{fmt(reteRenta)}</span>
        </div>
      )}
      <div
        className="border-t border-brand-200 pt-2 flex justify-between font-semibold text-brand-900 text-base"
        data-testid="inv-totals-total"
      >
        <span>Total a Pagar</span>
        {/* computeTotals.totalPagar = total + percepción − 1% retention − FSE renta (= resumen.totalPagar). */}
        <span>{fmt(totalPagar)}</span>
      </div>
    </div>
  );
}

export interface RentaRetentionOptionProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * Factura de Sujeto Excluido: "Aplicar retención de renta (10%)" (ON by
 * default). The 10% (Ley ISR art. 156) applies to services; purchases of goods
 * from a sujeto excluido are normally not withheld.
 */
export function RentaRetentionOption({ checked, onChange }: RentaRetentionOptionProps) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none" data-testid="fse-renta-option">
      <input
        type="checkbox"
        data-testid="fse-apply-renta"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-brand-300 text-accent-600 focus:ring-accent-500"
      />
      <span>
        <span className="block text-sm font-medium text-brand-800">Aplicar retención de renta (10%)</span>
        <span className="block text-xs text-brand-500">
          La retención del 10% aplica a servicios; desactívala para compras de bienes.
        </span>
      </span>
    </label>
  );
}

/** Short explanation shown to agentes de percepción on CCF / NC / ND. */
export function PerceptionNote({ applies, invoiceType }: { applies: boolean; invoiceType: InvoiceType }) {
  return (
    <p className="text-xs text-brand-500 mt-3" data-testid="perception-note">
      {applies
        ? invoiceType === InvoiceType.CCF
          ? 'Empresa agente de percepción: se suma 1% de IVA percibido cuando la base gravada es de $100.00 o más.'
          : 'El CCF relacionado lleva percepción: esta nota suma el 1% de IVA percibido de su base gravada.'
        : 'Empresa agente de percepción: este documento no lleva percepción (cliente gran contribuyente o CCF relacionado sin percepción).'}
    </p>
  );
}

export default InvoiceTotals;
