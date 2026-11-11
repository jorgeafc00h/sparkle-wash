// Compras email import — duplicates are detected per company and DTEs
// addressed to another NIT/NRC are not imported into the selected company.

jest.mock('@/services/storage/ElectronStorage', () => {
  const map = new Map<string, string>();
  return {
    __map: map,
    appStorage: {
      getItem: jest.fn(async (key: string) => (map.has(key) ? map.get(key)! : null)),
      setItem: jest.fn(async (key: string, value: string) => {
        map.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        map.delete(key);
      }),
      getAllKeys: jest.fn(async () => Array.from(map.keys())),
    },
  };
});

import { ImapImportService } from '@/services/compras/ImapImportService';
import { ComprasDatabase } from '@/services/compras/ComprasDatabase';
import { isAddressedToCompany, setCompanyIdentityResolver } from '@/services/compras/receptorMatch';

const COMPANY_NIT = '06140101011011';
const COMPANY_NRC = '1234567';

function dte(codigoGeneracion: string, receptor: Record<string, string>) {
  return {
    identificacion: {
      version: 3,
      ambiente: '01',
      tipoDte: '03',
      numeroControl: `DTE-03-M001P001-${codigoGeneracion.slice(0, 15)}`,
      codigoGeneracion,
      fecEmi: '2026-09-15',
      horEmi: '10:30:00',
    },
    emisor: { nit: '06142312341234', nrc: '123456', nombre: 'PROVEEDOR, S.A. DE C.V.' },
    receptor: { nombre: 'Receptor', ...receptor },
    cuerpoDocumento: [{ numItem: 1, descripcion: 'Servicio', cantidad: 1, precioUni: 100, ventaGravada: 100 }],
    resumen: { totalGravada: 100, totalIva: 13, totalPagar: 113, montoTotalOperacion: 113, condicionOperacion: 1 },
  };
}

function message(messageId: string, payload: unknown) {
  return {
    uid: 1,
    messageId,
    attachments: [
      {
        filename: 'dte.json',
        kind: 'json' as const,
        size: 100,
        contentBase64: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
      },
    ],
  };
}

const imapFetchAttachments = jest.fn();

beforeAll(() => {
  (globalThis as { window?: unknown }).window = { electronAPI: { imapFetchAttachments } };
  setCompanyIdentityResolver((companyId) =>
    companyId.startsWith('co-') ? { nit: '0614-010101-101-1', nrc: '123456-7' } : null,
  );
});

afterAll(() => {
  setCompanyIdentityResolver(null);
  delete (globalThis as { window?: unknown }).window;
});

const CREDS = { user: 'compras@empresa.com', password: 'app-password' };

describe('isAddressedToCompany', () => {
  const company = { nit: '0614-010101-101-1', nrc: '123456-7' };

  it('matches on NIT or NRC regardless of formatting', () => {
    expect(isAddressedToCompany({ receptorNit: COMPANY_NIT }, company)).toBe(true);
    expect(isAddressedToCompany({ receptorNit: '06149999999999', receptorNrc: COMPANY_NRC }, company)).toBe(true);
  });

  it('rejects a comparable NIT/NRC of another taxpayer', () => {
    expect(isAddressedToCompany({ receptorNit: '06149999999999' }, company)).toBe(false);
    expect(isAddressedToCompany({ receptorNrc: '7654321' }, company)).toBe(false);
  });

  it('accepts what it cannot compare (no receptor, DUI vs 14-digit NIT, unknown company)', () => {
    expect(isAddressedToCompany({}, company)).toBe(true);
    expect(isAddressedToCompany({ receptorNit: '012345678' }, { nit: COMPANY_NIT })).toBe(true);
    expect(isAddressedToCompany({ receptorNit: '06149999999999' }, null)).toBe(true);
  });
});

describe('ImapImportService — company scoping', () => {
  it('imports a DTE into a second company even when another company already has it', async () => {
    const payload = dte('AAAAAAAA-0000-0000-0000-000000000001', { nit: COMPANY_NIT });
    imapFetchAttachments.mockResolvedValue({ ok: true, messages: [message('<m1@mail>', payload)] });

    const first = await ImapImportService.syncComprasForCompany('co-test', CREDS, { afterDate: '2026-09-01' }, { autoVerify: false });
    expect(first).toMatchObject({ imported: 1, receptorMismatch: 0 });

    // Same mailbox, sibling PROD company: used to be skipped as a duplicate.
    const second = await ImapImportService.syncComprasForCompany('co-prod', CREDS, { afterDate: '2026-09-01' }, { autoVerify: false });
    expect(second).toMatchObject({ imported: 1 });

    // Re-sync of the same company is still de-duplicated.
    const again = await ImapImportService.syncComprasForCompany('co-prod', CREDS, { afterDate: '2026-09-01' }, { autoVerify: false });
    expect(again).toMatchObject({ imported: 0, skipped: 1 });

    expect(await ComprasDatabase.existsByCodigoGeneracion('AAAAAAAA-0000-0000-0000-000000000001', 'co-prod')).toBe(true);
    expect(await ComprasDatabase.existsByCodigoGeneracion('AAAAAAAA-0000-0000-0000-000000000001', 'co-other')).toBe(false);
  });

  it('skips and reports DTEs addressed to another NIT', async () => {
    imapFetchAttachments.mockResolvedValue({
      ok: true,
      messages: [
        message('<ours@mail>', dte('BBBBBBBB-0000-0000-0000-000000000002', { nit: COMPANY_NIT })),
        message('<theirs@mail>', dte('CCCCCCCC-0000-0000-0000-000000000003', { nit: '06149999999999', nrc: '7654321' })),
      ],
    });

    const result = await ImapImportService.syncComprasForCompany('co-mismatch', CREDS, { afterDate: '2026-09-01' }, { autoVerify: false });
    expect(result).toMatchObject({ imported: 1, skipped: 1, receptorMismatch: 1, errors: 0 });
    expect(await ComprasDatabase.existsByCodigoGeneracion('CCCCCCCC-0000-0000-0000-000000000003', 'co-mismatch')).toBe(false);
  });
});
