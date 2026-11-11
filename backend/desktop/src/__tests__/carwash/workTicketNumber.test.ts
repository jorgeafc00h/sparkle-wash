import { formatWorkTicketNumber, nextWorkTicketNumber, normalizeRegisterCode } from '@/services/carwash/workTicketNumber';
import { memoryStorage } from './testUtils';

describe('work ticket numbers', () => {
  it('formats OT-{code}-{seq:6}', () => {
    expect(formatWorkTicketNumber('C1', 45)).toBe('OT-C1-000045');
    expect(formatWorkTicketNumber('c-2', 1234567)).toBe('OT-C2-1234567');
    expect(normalizeRegisterCode('')).toBe('C1');
  });

  it('increments monotonically per register code and persists', async () => {
    const storage = memoryStorage();
    expect(await nextWorkTicketNumber('C1', storage)).toBe('OT-C1-000001');
    expect(await nextWorkTicketNumber('C1', storage)).toBe('OT-C1-000002');
    expect(await nextWorkTicketNumber('B2', storage)).toBe('OT-B2-000001');
    expect(await nextWorkTicketNumber('C1', storage)).toBe('OT-C1-000003');
  });

  it('never hands out the same number to concurrent calls', async () => {
    const storage = memoryStorage();
    const all = await Promise.all(Array.from({ length: 10 }, () => nextWorkTicketNumber('C1', storage)));
    expect(new Set(all).size).toBe(10);
    expect(all[9]).toBe('OT-C1-000010');
  });
});
