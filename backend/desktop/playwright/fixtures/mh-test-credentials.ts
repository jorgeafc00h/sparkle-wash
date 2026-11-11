/**
 * Test credentials for MH (Ministerio de Hacienda) integration — NOT in git.
 *
 * This repository is public, so the MH test-environment password, certificate key hash, API key and the
 * signing certificate (.crt XML with its private key) are supplied locally, never committed:
 *
 *   1. Environment variables: MH_TEST_PASSWORD, MH_TEST_CERT_KEY_SHA512, MH_TEST_API_KEY,
 *      MH_TEST_CERT_PATH (absolute path to the .crt), optionally MH_TEST_NIT; or
 *   2. playwright/fixtures/mh-test-credentials.local.json (git-ignored) with the same fields:
 *      { "nit", "mhPassword", "certificateKeySha512", "apiKey", "certificatePath" }.
 *      A relative certificatePath resolves against playwright/fixtures/.
 *
 * Without them the hermetic specs still run (mock MH, placeholder certificate) and the real-MH
 * Electron specs cannot authenticate. Credentials are bound to the MH *test* environment
 * (apitest.dtes.mh.gob.sv).
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOCAL_FILE = resolve(__dirname, 'mh-test-credentials.local.json');

interface LocalCredentials {
  nit?: string;
  mhPassword?: string;
  certificateKeySha512?: string;
  apiKey?: string;
  certificatePath?: string;
}

const local: LocalCredentials = existsSync(LOCAL_FILE)
  ? (JSON.parse(readFileSync(LOCAL_FILE, 'utf-8')) as LocalCredentials)
  : {};

const nit = process.env.MH_TEST_NIT ?? local.nit ?? '06141404941342';

/**
 * Stand-ins for mock-MH runs (web specs, MH_MOCK=1 Electron specs) when no real credentials are supplied.
 * They are fake: they only satisfy "credentials are configured" checks and never reach Hacienda.
 */
export const MOCK_MH_PASSWORD = 'sparklewash-mock-mh-password';
/** SHA-512 of the fake certificate password 'sparklewash-mock-cert-password'. */
export const MOCK_CERT_KEY_SHA512 = '1fd672676b3c8cf803db4f04d0f8f3cd75a0a130164a3382976f40c01e6dc49b66c86b4ea7c752f408866de59ce0433033a023930da7f8aa2eb9f70716f9c2a3';
export const MOCK_API_KEY = 'sparklewash-mock-api-key';
const certificatePathSetting = process.env.MH_TEST_CERT_PATH ?? local.certificatePath ?? resolve(__dirname, 'certificates', `${nit}.crt`);

/** Stand-in used when the real certificate is not available (hermetic / mock-MH runs only). */
export const PLACEHOLDER_CERTIFICATE_XML = '<CertificadoMH test="playwright"/>';

export const MH_TEST_CREDENTIALS = {
  /** NIT of the test issuer (matches `TEST_COMPANY.nit` when dashes are stripped). */
  nit,
  /** Formatted NIT as the UI stores it. */
  nitFormatted: '0614-140494-134-2',
  /** MH API password — value used in the `MH_KEY` header. */
  mhPassword: process.env.MH_TEST_PASSWORD ?? local.mhPassword ?? MOCK_MH_PASSWORD,
  /** SHA-512 hash of the certificate password (`key` header for the Azure proxy). */
  certificateKeySha512: process.env.MH_TEST_CERT_KEY_SHA512 ?? local.certificateKeySha512 ?? MOCK_CERT_KEY_SHA512,
  /** API key for the Azure proxy (same constant as `config/api.ts::API_CONFIG.apiKey`). */
  apiKey: process.env.MH_TEST_API_KEY ?? local.apiKey ?? MOCK_API_KEY,
  /** MH ambiente code for the test environment. '00' = test, '01' = production. */
  environmentCode: '00',
  /** Direct government API (when signing locally and submitting ourselves). */
  mhTestApiUrl: 'https://apitest.dtes.mh.gob.sv',
  /** Absolute path to the test certificate XML (may not exist; see `hasMhTestCertificate`). */
  get certificatePath() {
    return isAbsolute(certificatePathSetting) ? certificatePathSetting : resolve(__dirname, certificatePathSetting);
  },
};

/** True when the real MH test credentials and certificate are available locally. */
export const hasMhTestCredentials =
  MH_TEST_CREDENTIALS.mhPassword !== MOCK_MH_PASSWORD &&
  MH_TEST_CREDENTIALS.certificateKeySha512 !== MOCK_CERT_KEY_SHA512 &&
  existsSync(MH_TEST_CREDENTIALS.certificatePath);

/** The certificate XML, or a placeholder when it isn't available (enough for mock-MH runs). */
export function readMhTestCertificateXml(): string {
  return existsSync(MH_TEST_CREDENTIALS.certificatePath)
    ? readFileSync(MH_TEST_CREDENTIALS.certificatePath, 'utf-8')
    : PLACEHOLDER_CERTIFICATE_XML;
}

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
