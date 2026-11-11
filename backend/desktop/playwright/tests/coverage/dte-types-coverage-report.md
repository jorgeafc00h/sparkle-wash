# DTE Types Coverage — End-to-End Test Matrix

All tests run against the **real MH test environment** (`https://apitest.dtes.mh.gob.sv`) via the Electron process. No mocks are used.

## Full E2E Tests (real MH submission)

| Test file | DTE types tested | Invoices per batch | Total docs |
|---|---|:---:|:---:|
| `electron/04-all-dte-types.spec.ts` | **All 11**: Factura, CCF, NC, ND, NR, CL, CR, DCL, DocumentoContableLiquidacion, SujetoExcluido, FacturaExportacion + Contingencia batch + Invalidación batch | 5 | 55 (61 if counting events) |
| `electron/05-request-production-e2e.spec.ts` | **All 11** DTE types (same sweep as 04) + Contingencia + Invalidación | 5 | 55 |
| `electron/05b-request-production-events.spec.ts` | Contingencia batch + Invalidación batch | 5 each | 10 |
| `electron/03-validate-dte-submit.spec.ts` | Factura | 1 | 1 |
| `coverage/02-dte-submission-mock-mh.spec.ts` | Factura, CCF, NC | 4 each | 12 |

## Summary of all DTE types covered in E2E tests

- **Factura (01)**        → ✅ real MH (`electron/03`, `electron/05`, `electron/05b`) + Mock (`coverage/02`)
- **CCF (03)**           → ✅ real MH (`electron/05`, `electron/05b`) + Mock (`coverage/02`)
- **NotaCrédito (02)**  → ✅ real MH (`electron/04`, `electron/05`, `electron/05b`) + Mock (`coverage/02`)
- **NotaDébito (02)**   → ✅ real MH (`electron/04`, `electron/05`, `electron/05b`)
- **NotaRemisión (04)**  → ✅ real MH (`electron/04`, `electron/05`, `electron/05b`)
- **ComprobanteLiquidacion (05)** → ✅ real MH (`electron/04`, `electron/05`, `electron/05b`)
- **ComprobanteRetencion (06)** → ✅ real MH (`electron/04`, `electron/05`, `electron/05b`)
- **DocumentoContableLiquidacion (07)** → ✅ real MH (`electron/04`, `electron/05`, `electron/05b`)
- **SujetoExcluido (09)** → ✅ real MH (`electron/04`, `electron/05`, `electron/05b`)
- **FacturaExportacion (10)** → ✅ real MH (`electron/04`, `electron/05`, `electron/05b`)
- **ComprobanteDonacion (12)** → ✅ real MH (`electron/04`, `electron/05`, `electron/05b`)

**Total:** All 11 DTE types are covered by real-MH submission tests.

## UI-level workflow tests (no real MH submission — local only)

| File | What it validates |
|---|---|
| `invoices/01-invoice-list.spec.ts` | list rendering, search, batch delete of draft-only invoices |
| `invoices/02-create-invoice.spec.ts` | type picker → form navigation, draft creation, persistence |
| `invoices/05-create-invoice-e2e.spec.ts` | full form fill + persistence in appStorage |
| `invoices/03-invoice-detail.spec.ts` | detail view, actions menu, PDF preview, invoice invalidation UI |
| `invoices/04-linked-documents.spec.ts` | NC/ND/NR/CL/Duplicate actions from CCF or Factura |
| `invoices/06-factura-nodui-dte.spec.ts` | nullable receptor for non-NIT receivers (mock) |
| `invoices/07-ccf-iva-rounding.spec.ts` | per-item base sum for CCF, retention handling |
| `invoices/08-invoice-discounts.spec.ts` | percentage discounts, IVA on net, CCF-specific base calculation |
| `invoices/mark-as-contingency.spec.ts` | contingency flag action on draft invoices |
| `invoices/09-sticky-toolbars.spec.ts` | sticky search/filter bar while scrolling |
| `coverage/04-linked-docs-edit-duplicate.spec.ts` | shared DTE edit/duplicate validation |
| `pro/*/libros-iva*`, `pro/*/google-drive*`, `pro/*` | export formats, Drive upload, Libros IVA annex generation |

## Non-DTE end-to-end tests (local feature validation)

| File | Subject |
|---|---|
| `pos/01-pos-sale.spec.ts` | counter sale → draft ticket → F2 cash payment |
| `pos/02-closing-consolidation-libros.spec.ts` | X/Z closing, consolidation wizard, Libros IVA reconciliation |
| `pos/03-ticket-discounts.spec.ts` | POS discount codes → consolidated invoice |
| `products/*` | product list, categories, stock adjustment |
| `customers/*` | customer CRUD |
| `compras/*` | compras list, IMAP import, GreenMail mock |
| `chat/*` | Lisy Chat API integration |
| `docs/capture-*.spec.ts` | screenshot capture for the user manual |

---

**Key takeaway:** The only tests that exercise a full request → DB write → DTE generation → MH submission → `PROCESADO` receipt are the five files in `electron/01–05*`. All other invoice tests stop at local storage.
