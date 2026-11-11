# Tasks — DTE withholding options (release 1.4.0, owner F)

- [x] 1 `applyRentaRetention?: boolean` on Invoice/CreateInvoiceInput (default true for FSE); `computeTotals` option; FSE mapper reads it
- [x] 2 FSE editor option (AddInvoicePage / EditInvoicePage) with Spanish help text; PDF + Excel follow stored totals
- [x] 3 `Company.isPerceptionAgent`, `Customer.isLargeTaxpayer` (+ company config toggle, customer form checkbox)
- [x] 4 `computeTotals` ivaPerci1 (CCF ≥ $100 base, agent, receptor not large) + NC/ND proportional; `totalPagar` includes it; `saleResumen` ivaPerci1; totals panel / PDF / Excel line
- [x] 5 Jest: FSE on/off, percepción thresholds and conditions, NC/ND, DTE resumen parity
- [x] 6 Playwright: FSE option + CCF percepción totals in the editor and detail
- [x] 7 Electron real MH: FSE without renta and CCF with percepción (record MH's answer)


Result (2026-11-01): MH TEST accepted FSE without renta ($200.00), CCF with percepción $5.00 (total $570.00) and NC with percepción $0.50 — codigoMsg 001, no observaciones. Production designation of the emisor as agente is not testable in TEST; the feature is off by default per company.
