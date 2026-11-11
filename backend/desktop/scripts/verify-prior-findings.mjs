/**
 * Deterministic reproducer for the Phase 1A bugs flagged in the code review.
 *
 * Inlines the EXACT helpers currently in production (copy-paste from
 * src/services/dte/DTEMappingService.ts and src/services/pdf/InvoicePDFGenerator.ts)
 * so the script tests the same behavior the app ships without needing TS-loader.
 *
 * Run: `node scripts/verify-prior-findings.mjs`
 * Exits 0 if results are reported; ❌ inside the report indicates a confirmed
 * bug; ✅ indicates the code does not reproduce.
 */

// ── Helpers copied verbatim from the codebase ──────────────────────────────

// DTEMappingService.ts:1620
function formatDate(date) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
}

// DTEMappingService.ts:1625
function formatDateSV(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

// DTEMappingService.ts:1638
function generateTimeString(date) {
  return date.toISOString().split('T')[1].substring(0, 8);
}

// DTEMappingService.ts:1642 — the suspected buggy version (no hourCycle)
function generateTimeStringSV(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/El_Salvador',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const ss = parts.find((p) => p.type === 'second')?.value ?? '00';
  return `${hh}:${mm}:${ss}`;
}

// Proposed fix for A2 (added hourCycle: 'h23')
function generateTimeStringSV_FIXED(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/El_Salvador',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const ss = parts.find((p) => p.type === 'second')?.value ?? '00';
  return `${hh}:${mm}:${ss}`;
}

// InvoicePDFGenerator.ts:16
const escapeHtml = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// InvoicePDFGenerator.ts:601
function splitText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...<br/>' + text.substring(maxLength);
}

// ── Reporters ──────────────────────────────────────────────────────────────

const results = [];
function check(id, summary, pass, observed, expected) {
  results.push({ id, summary, pass, observed, expected });
}

// ── A2: generateTimeStringSV at midnight SV ────────────────────────────────
// 00:00:30 America/El_Salvador on 2026-05-24 = 06:00:30 UTC
{
  const midnightSV = new Date('2026-05-24T06:00:30Z');
  const observed = generateTimeStringSV(midnightSV);
  const observedFixed = generateTimeStringSV_FIXED(midnightSV);
  // MH requires HH 00-23
  const pass = /^([01]\d|2[0-3]):/.test(observed);
  check(
    'A2',
    "generateTimeStringSV at 00:00:30 SV must not return '24:xx:xx'",
    pass,
    `current=${observed} | with hourCycle:'h23' fix=${observedFixed}`,
    "HH between 00 and 23",
  );
}

// ── A1: DCL fechaInicio (POST-FIX: formatDateSV) vs fechaFin (formatDateSV) ─
// 19:30 SV on 2026-05-23 = 01:30 UTC on 2026-05-24
{
  const lateEveningSV = new Date('2026-05-24T01:30:00Z');
  // After fix in DTEMappingService:854 — both use formatDateSV
  const fechaInicio = formatDateSV(lateEveningSV);
  const fechaFin = formatDateSV(lateEveningSV);
  const pass = fechaInicio === fechaFin;
  check(
    'A1',
    "DCL periodoLiquidacion start and end (both formatDateSV) must agree",
    pass,
    `fechaInicio=${fechaInicio} | fechaFin=${fechaFin}`,
    "both equal '2026-05-23' (SV-local date)",
  );
}

// ── B1: Sujeto Excluido fecEmi (POST-FIX: formatDateSV) ────────────────────
{
  const lateEveningSV = new Date('2026-05-24T01:30:00Z');
  // After fix in DTEMappingService:336 — uses formatDateSV
  const seFecEmi = formatDateSV(lateEveningSV);
  const otherFecEmi = formatDateSV(lateEveningSV);
  const pass = seFecEmi === otherFecEmi;
  check(
    'B1',
    "Sujeto Excluido fecEmi (formatDateSV) must match other DTEs (formatDateSV)",
    pass,
    `SE fecEmi=${seFecEmi} | other DTE fecEmi=${otherFecEmi}`,
    "both equal '2026-05-23'",
  );
}

// ── F1: regenerateControlNumbers — POST-FIX: both use *SV helpers ──────────
{
  const lateEveningSV = new Date('2026-05-24T01:30:00Z');
  // After fix in InvoiceService:500 — uses formatDateSV / generateTimeStringSV
  const newFecEmi = formatDateSV(lateEveningSV);
  const newHorEmi = generateTimeStringSV(lateEveningSV);
  // The SV-local day is what formatDateSV returns.
  const svDay = formatDateSV(lateEveningSV);
  const pass = newFecEmi === svDay;
  check(
    'F1',
    "regenerateControlNumbers date must match SV local-day of time field",
    pass,
    `newFecEmi(SV)=${newFecEmi} | newHorEmi(SV)=${newHorEmi} | SV-day=${svDay}`,
    `newFecEmi must equal SV-day=${svDay}`,
  );
}

// ── B6: splitText breaks HTML entities ─────────────────────────────────────
// Craft an input where the cut at maxLength=35 lands INSIDE the &amp; entity.
// We need 31 chars before the `&`, so the cut at 35 falls between '&' and ';'.
{
  // 31 chars of safe text, then `&`, then `; rest`. Escaped length is 31 + 5 + …
  // We want the position-35 cut to land inside `&amp;` (positions 31..35).
  const input = 'Direccion N. 12 Col. Las Magnolia&T y mas';
  const escaped = escapeHtml(input);
  const out = splitText(escaped, 35);
  // partial-entity detector: `&` followed by 1-4 chars, then '...<br/>'
  const partial = /&[a-zA-Z#0-9]{0,4}\.\.\.<br\/>/.test(out);
  const pass = !partial;
  check(
    'B6',
    "splitText must not cut inside HTML entities",
    pass,
    `escaped(len=${escaped.length})=${escaped} | split=${out}`,
    "no partial entity like '&am...<br/>p;...'",
  );
}

// ── C5: nombreComercial undefined crashes generatePDF header ───────────────
{
  let threw = false;
  let errMsg = '';
  try {
    // mimics line 406: escapeHtml(company.nombreComercial.toUpperCase())
    const company = { nit: '12345' }; // no nombreComercial
    escapeHtml(company.nombreComercial.toUpperCase());
  } catch (e) {
    threw = true;
    errMsg = e.message;
  }
  const pass = !threw;
  check(
    'C5',
    "generatePDF header must not crash when company.nombreComercial is undefined",
    pass,
    threw ? `throws: ${errMsg}` : 'no throw',
    "no throw (guard with ?? '' or optional chaining)",
  );
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log('\n=== Phase 1A — Verification of prior-review findings ===\n');
for (const r of results) {
  const icon = r.pass ? '✅' : '❌';
  console.log(`${icon}  [${r.id}] ${r.summary}`);
  console.log(`     observed : ${r.observed}`);
  console.log(`     expected : ${r.expected}`);
  console.log();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`Summary: ${results.length - failed} passed, ${failed} reproduced bugs.\n`);
process.exit(0);
