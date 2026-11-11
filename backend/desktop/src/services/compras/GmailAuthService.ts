// Gmail API access for a company's linked inbox.
//
// The link remembers the Google account id, so an expired access token is
// renewed with the refresh token the Electron main process keeps — Gmail
// sync used to stop working about an hour after linking. Granted scopes are
// checked: with granular consent the user can untick Gmail and still finish
// the Google flow.

import GoogleAuthService, { GOOGLE_SCOPES } from '../auth/GoogleAuthService';
import { ComprasDatabase } from './ComprasDatabase';

const GMAIL_SCOPE = GOOGLE_SCOPES.GMAIL_READONLY;
const EXPIRY_MARGIN_MS = 60_000;

export const GMAIL_RECONNECT_MESSAGE =
  'La conexión con Gmail expiró o fue revocada. Vuelve a conectar la cuenta en Ajustes de compras.';

const GMAIL_DENIED_MESSAGE =
  'No concediste acceso de lectura a Gmail. Vuelve a intentarlo y marca la casilla de Gmail en la pantalla de Google.';

async function saveLink(
  companyId: string,
  email: string,
  accessToken: string,
  googleAccountId: string,
  tokenExpiresAt: number,
): Promise<void> {
  await ComprasDatabase.linkGmail(companyId, email, accessToken, undefined, { googleAccountId, tokenExpiresAt });
}

/**
 * Links (or re-links) a Gmail inbox to the company.
 * - default: reuse the app's Google session when it already carries Gmail
 *   access, otherwise open the Google consent for it;
 * - `reauthorize`: always open the consent (keeps the linked account as hint);
 * - `switchAccount`: open the consent with no account hint.
 */
export async function linkGmailAccount(
  companyId: string,
  options: { reauthorize?: boolean; switchAccount?: boolean } = {},
): Promise<{ email: string; accessToken: string }> {
  const session = await GoogleAuthService.getCurrentUser();

  if (session && !options.reauthorize && !options.switchAccount) {
    try {
      const accessToken = await GoogleAuthService.getAccessTokenForScope(GMAIL_SCOPE);
      const current = await GoogleAuthService.getSession();
      // Unknown expiry → 0: the next sync renews it from the refresh token.
      const expiresAt = current?.accessToken === accessToken ? current.expiresAt : 0;
      await saveLink(companyId, session.email, accessToken, session.id, expiresAt);
      return { email: session.email, accessToken };
    } catch {
      // Session has no (renewable) Gmail access — ask for it below.
    }
  }

  const linked = await ComprasDatabase.getLinkedGmail(companyId);
  const auth = await GoogleAuthService.authorize({
    scopes: [GMAIL_SCOPE],
    loginHint: options.switchAccount ? undefined : linked?.email ?? session?.email,
    updateSession: 'same-account',
  });
  if (!auth.grantedScopes.includes(GMAIL_SCOPE)) throw new Error(GMAIL_DENIED_MESSAGE);

  await saveLink(companyId, auth.user.email, auth.accessToken, auth.user.id, auth.expiresAt);
  return { email: auth.user.email, accessToken: auth.accessToken };
}

/**
 * A valid Gmail access token for the company's linked inbox: cached token →
 * refresh token → (interactive only) a new consent. Null when no inbox is
 * linked or the token can't be renewed without the user.
 */
export async function getGmailAccessToken(
  companyId: string,
  options: { interactive?: boolean } = {},
): Promise<string | null> {
  const linked = await ComprasDatabase.getLinkedGmail(companyId);
  if (!linked) return null;

  if (linked.accessToken && linked.tokenExpiresAt && linked.tokenExpiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return linked.accessToken;
  }

  if (linked.googleAccountId) {
    const refreshed = await GoogleAuthService.refreshAccount(linked.googleAccountId, GMAIL_SCOPE);
    if (refreshed?.grantedScopes.includes(GMAIL_SCOPE)) {
      await saveLink(companyId, linked.email, refreshed.accessToken, linked.googleAccountId, refreshed.expiresAt);
      return refreshed.accessToken;
    }
  }

  if (!options.interactive) return null;
  return (await linkGmailAccount(companyId, { reauthorize: true })).accessToken;
}
