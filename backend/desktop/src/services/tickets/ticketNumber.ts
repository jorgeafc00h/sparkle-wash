// Ticket display numbers (POS Phase 2, design §1).
//
// Each device is a register. A ticket keeps the per-device `sequential` it was
// given; the register code disambiguates peers: `C1-000123`. Tickets without a
// code (legacy, or a single register that never set one) keep `#000123`.
// Every screen, toast and receipt formats numbers through these helpers.

export interface TicketNumberSource {
  sequential: number;
  registerCode?: string;
}

/** Register codes are short and printable: A–Z / 0–9, at most 4 characters ("C1", "CAJA"). */
export const REGISTER_CODE_MAX_LENGTH = 4;

export function normalizeRegisterCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, REGISTER_CODE_MAX_LENGTH);
}

export function padTicketSequential(sequential: number): string {
  const n = Number.isFinite(sequential) && sequential > 0 ? Math.floor(sequential) : 0;
  return String(n).padStart(6, '0');
}

/** Full display number: `C1-000123`, or `#000123` without a register code. */
export function formatTicketNumber(ticket: TicketNumberSource): string {
  const code = normalizeRegisterCode(ticket.registerCode);
  const number = padTicketSequential(ticket.sequential);
  return code ? `${code}-${number}` : `#${number}`;
}

/**
 * Short label for toasts and log lines: `C1-000123` with a register code,
 * otherwise the historical `#123`.
 */
export function ticketShortLabel(ticket: TicketNumberSource): string {
  const code = normalizeRegisterCode(ticket.registerCode);
  return code ? `${code}-${padTicketSequential(ticket.sequential)}` : `#${ticket.sequential}`;
}

/** Text a ticket search matches on: every spelling of its number. */
export function ticketNumberSearchText(ticket: TicketNumberSource): string {
  return `${formatTicketNumber(ticket)} #${ticket.sequential} ${padTicketSequential(ticket.sequential)}`;
}
