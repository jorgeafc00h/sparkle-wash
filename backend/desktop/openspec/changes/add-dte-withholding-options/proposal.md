# Add DTE withholding options — FSE renta toggle and IVA percepción (1%)

## Why

- Every Factura de Sujeto Excluido (FSE) withholds 10% income tax (`reteRenta`) unconditionally. The
  10% withholding (Ley ISR art. 156) applies to services rendered by excluded subjects; purchases
  of goods from them are normally not withheld. Users buying goods (produce, crafts) can't issue a
  correct FSE today.
- The app never computes **IVA percepción 1%** (Código Tributario art. 163): taxpayers designated
  by the DGII as *agentes de percepción* (grandes contribuyentes) must add 1% of the base to CCF
  sales of $100 or more to buyers that are not grandes contribuyentes. MH's CCF/NC/ND schemas carry
  `resumen.ivaPerci1`; the app always sends 0.

## What Changes

- **FSE**: a per-document option "Aplicar retención de renta (10%)" (default ON = current
  behavior). OFF → `reteRenta` 0, `totalPagar` = total; stored on the invoice
  (`applyRentaRetention: false`) so totals, DTE, PDF and exports agree.
- **Percepción**: company setting "Agente de percepción de IVA" (default OFF); customer flag
  "Gran contribuyente". When the company is an agent and the receptor is not a gran contribuyente,
  a CCF with gravado base ≥ $100.00 gets `ivaPerci1` = 1% of the gravado base (rounded half-up to
  cents); `totalPagar` = total + ivaPerci1 − ivaRete1. NC/ND referencing such a CCF carry the
  proportional percepción (1% of their base) when the same conditions hold. Shown in the totals
  panel, the PDF and the Excel export; Anexo of percepción not in scope.

## Impact

- `src/utils/invoiceTotals.ts` (`computeTotals` options), `src/services/dte/DTEMappingService.ts`
  (`saleResumen` ivaPerci1, FSE reteRenta), `src/types/invoice.ts` / `company.ts` / `customer.ts`
  (additive fields), invoice editor (FSE option), company config + customer form (flags), PDF,
  Excel export.
- Real-MH Electron spec: FSE without renta and a CCF with percepción accepted by the MH test
  environment (if MH refuses percepción for a test emisor that is not a designated agent, the spec
  records MH's answer and the feature stays behind the company setting).
