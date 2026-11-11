/**
 * Test credentials for MH (Ministerio de Hacienda) integration.
 *
 * Values copied verbatim from the dotnet API integration-test fixture:
 *   /Users/jorgeflores/github/FACTURAS SIMPLES/Invoices.Api/Test/Integration/InvoiceSyncTests/InvoiceSyncBaseTest.cs
 *
 * Certificate file sits at:
 *   playwright/fixtures/certificates/06141404941342.crt
 *
 * These credentials are bound to the MH *test* environment (apitest.dtes.mh.gob.sv).
 * They are safe to check into the repo because the dotnet repo already has them.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const MH_TEST_CREDENTIALS = {
  /** NIT of the test issuer (matches `TEST_COMPANY.nit` when dashes are stripped). */
  nit: '06141404941342',
  /** Formatted NIT as the UI stores it. */
  nitFormatted: '0614-140494-134-2',

  /** MH API password — value used in the `MH_KEY` header. */
  mhPassword: 'MemoryLeak00.',

  /**
   * Certificate key — the SHA512 hash of the cert password, used in the
   * `key` header when submitting a DTE via the Azure proxy (/document/dte/v2/sync).
   * Since MH does the decryption server-side, we don't need the plaintext.
   */
  certificateKeySha512:
    '99bbf24340687539663f028e9d07e98c2c814f17796978c06e9e6678a2d53c3fc33e8d161fdd22f927a939496ab2f7193f02337995321770c2e1e741427a89d6',

  /** API key for Azure proxy. Same constant as `config/api.ts::API_CONFIG.apiKey`. */
  apiKey: 'eyJhbGciOiJFUzI1NiIsImtpZCI6IlVSS0VZSUQwMDEifQ',

  /** MH ambiente code for the test environment. '00' = test, '01' = production. */
  environmentCode: '00',

  /** Direct government API (when signing locally and submitting ourselves). */
  mhTestApiUrl: 'https://apitest.dtes.mh.gob.sv',

  /** Absolute path to the test certificate XML. */
  get certificatePath() {
    return resolve(__dirname, 'certificates', '06141404941342.crt');
  },
};

/**
 * Default MH user credentials (user + password) the app stores via
 * SecureStorageService.storeCredentials(...). The Azure proxy sends these
 * through to MH on each submission.
 */
export const MH_TEST_STORED_CREDENTIALS = {
  user: MH_TEST_CREDENTIALS.nit,
  password: MH_TEST_CREDENTIALS.mhPassword,
  certificateKey: MH_TEST_CREDENTIALS.certificateKeySha512,
};
