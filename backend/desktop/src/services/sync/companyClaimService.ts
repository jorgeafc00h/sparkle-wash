// Company claim (Device Sync v2, Phase 1) — POST /api/auth/companies/claim.
//
// Ownership of a company's NIT is PROVEN, not asserted: the call sends the company's
// Hacienda credentials (MH_USER / MH_KEY headers, the same pair /api/account/validate
// uses) together with the internal app JWT, and the backend links co{NIT} to the
// account — the `companies` claim the sync relay authorizes on. The endpoint is
// idempotent (re-claiming an already-linked company is a 200 that refreshes the
// session), and the response carries a refreshed internal JWT that now includes the
// company; callers persist it so the next sync session is accepted.
//
// NEVER log the credentials, the headers that carry them or any JWT.

import { API_CONFIG, API_ENDPOINTS, getApiConfig } from '../../config/api';
import { isViteProduction } from '@/config/viteEnv';
import AuthProviderService from '../auth/AuthProviderService';
import { SecureStorageService } from '../security/SecureStorageService';
import { CompanyEnvironment } from '@/types';

/** The subset of Company the claim needs. */
export interface ClaimableCompany {
  nit?: string;
  environment?: CompanyEnvironment;
}

interface ClaimSessionBody {
  internalJwt?: string;
  companies?: string[];
}

interface ClaimResponseBody {
  companyId?: string;
  session?: ClaimSessionBody;
  error?: string;
}

export type CompanyClaimResult =
  | { kind: 'claimed'; companyId: string; companies: string[]; token: string | null }
  | { kind: 'already-claimed'; companyId: string; companies: string[]; token: string | null }
  | { kind: 'invalid-credentials'; message: string }
  | { kind: 'unauthenticated'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'missing-credentials'; message: string }
  | { kind: 'error'; message: string };

/** es-SV user-facing copy for every claim outcome. */
export const CLAIM_MESSAGES = {
  claimed: 'Empresa vinculada a tu cuenta.',
  alreadyClaimed: 'Esta empresa ya estaba vinculada a tu cuenta.',
  invalidCredentials: 'Hacienda rechazó el usuario o la contraseña de la empresa. Verifícalos en Credenciales API y vuelve a intentar.',
  nitMismatch: 'El usuario de Hacienda debe ser el NIT de esta empresa.',
  unauthenticated: 'Inicia sesión de nuevo para vincular la empresa.',
  unavailable: 'Hacienda no está disponible en este momento. Intenta de nuevo en unos minutos.',
  missingCredentials: 'Guarda las credenciales de Hacienda de esta empresa (Credenciales API) para vincularla.',
  error: 'No se pudo conectar con el servicio. Revisa tu conexión e intenta de nuevo.',
} as const;

/** Hacienda environment of the credentials: "00" Pruebas / "01" Producción. */
export const ambienteForCompany = (company: ClaimableCompany): '00' | '01' =>
  company.environment === CompanyEnvironment.Production ? '01' : '00';

export interface ClaimCompanyOptions {
  /**
   * The caller knows this company is already linked (persisted claim state or the
   * sign-in session's companies). The endpoint is still called — it is idempotent and
   * returns a refreshed JWT — but the outcome is reported as already-claimed.
   */
  alreadyClaimed?: boolean;
}

export interface ClaimCompanyDeps {
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string | null>;
  getCredentials?: (nit?: string, isProduction?: boolean) => Promise<{ user: string; password: string } | null>;
}

const digits = (value: string | undefined): string => (value ?? '').replace(/\D/g, '');

/**
 * Proves ownership of `company`'s NIT and links co{NIT-digits} to the signed-in
 * account. Transient problems (offline, Hacienda down, not signed in, credentials
 * not saved yet) leave the company unclaimed so a later sign-in retries.
 */
export async function claimCompany(
  company: ClaimableCompany,
  options: ClaimCompanyOptions = {},
  deps: ClaimCompanyDeps = {},
): Promise<CompanyClaimResult> {
  const nit = digits(company.nit);
  if (!nit) {
    return { kind: 'error', message: 'La empresa no tiene NIT configurado.' };
  }

  const getToken = deps.getToken ?? (async () => AuthProviderService.getFreshToken());
  const token = await getToken();
  if (!token) {
    return { kind: 'unauthenticated', message: CLAIM_MESSAGES.unauthenticated };
  }

  const ambiente = ambienteForCompany(company);
  const getCredentials = deps.getCredentials ?? SecureStorageService.getCredentials.bind(SecureStorageService);
  const credentials = await getCredentials(company.nit, ambiente === '01');
  if (!credentials?.password) {
    return { kind: 'missing-credentials', message: CLAIM_MESSAGES.missingCredentials };
  }

  const doFetch = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  if (!doFetch) {
    return { kind: 'error', message: CLAIM_MESSAGES.error };
  }

  let response: Response;
  try {
    response = await doFetch(`${getApiConfig(isViteProduction()).baseUrl}${API_ENDPOINTS.AUTH_COMPANIES_CLAIM}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apiKey: API_CONFIG.apiKey,
        Authorization: `Bearer ${token}`,
        // Same headers /api/account/validate uses to authenticate against Hacienda.
        MH_USER: credentials.user || nit,
        MH_KEY: credentials.password,
      },
      body: JSON.stringify({ nit, ambiente }),
    });
  } catch {
    return { kind: 'error', message: CLAIM_MESSAGES.error };
  }

  const body = await response.json().catch(() => ({}) as ClaimResponseBody);
  if (response.ok) {
    const companyId = String((body as ClaimResponseBody).companyId ?? `co${nit}`);
    const session = (body as ClaimResponseBody).session;
    const payload = {
      companyId,
      companies: Array.isArray(session?.companies) ? session!.companies!.map(String) : [],
      token: typeof session?.internalJwt === 'string' && session.internalJwt ? session.internalJwt : null,
    };
    return options.alreadyClaimed
      ? { kind: 'already-claimed', ...payload }
      : { kind: 'claimed', ...payload };
  }

  if (response.status === 401) {
    return { kind: 'unauthenticated', message: CLAIM_MESSAGES.unauthenticated };
  }
  const error = typeof (body as ClaimResponseBody).error === 'string' ? (body as ClaimResponseBody).error! : '';
  if (response.status === 403 && error === 'nit_mismatch') {
    return { kind: 'invalid-credentials', message: CLAIM_MESSAGES.nitMismatch };
  }
  if (response.status === 403) {
    return { kind: 'invalid-credentials', message: CLAIM_MESSAGES.invalidCredentials };
  }
  if (response.status === 503 || error === 'mh_unavailable') {
    return { kind: 'unavailable', message: CLAIM_MESSAGES.unavailable };
  }
  return { kind: 'error', message: CLAIM_MESSAGES.error };
}
