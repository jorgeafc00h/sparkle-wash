# Round 109 — Fix Frontend TypeScript Compilation Errors

## Situation
The production build fails because several component files have TypeScript syntax
errors. I'm fixing all broken files so `npm run build` succeeds.

## Errors found by `tsc --noEmit`
1. `src/components/DigitalReceiptCard.tsx` (root) — broken JSX, multiple syntax errors
2. `src/components/DigitalReceiptCard.tsx` (customer subdir) — missing imports/types, broken style expressions
3. `src/hooks/usePaymentStore.ts` — extra semicolon in object literal (line 13)
4. `src/pwa/service-worker.ts` — destructuring `let { event, cache }` at top level (not in a function)
5. `src/pages/customer/VerifyPayment.tsx` — uses `Fragment` without importing it; weird export

Also found `src/components/Dashboard.tsx` imports undefined modules (`@/components/ui/Badge`, etc.)
and `StationCard.tsx` references an undefined `pressurePsi`.

### Fix approach per file

**usePaymentStore.ts** — Remove the trailing semicolons inside the returned object literal.

**service-worker.ts** — Move the destructuring inside a function or remove the `let` binding entirely;
the module is mostly dead PWA code. We keep a minimal valid implementation.

**VerifyPayment.tsx** — Import `Fragment` from `react`; use the existing `DigitalReceiptCard` from the
customer dir with the correct prop shape ({ id, total, timestamp, stationId }); fix the export.

**customer/DigitalReceiptCard.tsx** — Add missing type import for `DigitalReceiptCardProps`, fix the
broken `background`/`letterSpacing` style expressions that are syntactically invalid.

**component/DigitalReceiptCard.tsx** (root) — Rewrite cleanly so it imports only existing modules
(`@/components/ui/Card`, `@/components/ui/StatusBadge`), removes `Skeleton`/`Badge`/refs that don't
exist, and uses well-formed JSX.

**components.ts barrel** — Ensure barrel file exports the correct receipt card with a matching signature.

## Not done yet
Continue fixing `Dashboard.tsx` and `StationCard.tsx`; then run `tsc --noEmit` and `npm run build`.
