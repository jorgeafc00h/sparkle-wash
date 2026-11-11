/**
 * Singleton bridge between the imperative `N1COService.handle3DS(authUrl)`
 * call and the React modal that renders the N1CO challenge in an iframe.
 *
 * Why a singleton instead of context / hooks: the call site is a Redux thunk
 * (`purchaseN1CO`, `changePaymentMethodN1CO`) which has no access to React
 * hooks. The thunk awaits a Promise; the modal resolves it.
 *
 * N1CO's documented 3DS flow is iframe + postMessage from
 * `https://front-3ds.n1co.com` (see /en/docs/integration-api/authentication3ds).
 * The old Electron BrowserWindow popup approach can't receive these messages
 * because there's no parent window in a top-level navigation.
 */

type Resolver = (result: ThreeDSResult) => void;
type Listener = (state: { authUrl: string | null }) => void;

export interface ThreeDSResult {
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'ERROR' | 'EXPIRED' | 'PENDING';
  authenticationId?: string;
}

class ThreeDSChallengeImpl {
  private resolver: Resolver | null = null;
  private listeners = new Set<Listener>();
  private authUrl: string | null = null;

  /**
   * Opens the 3DS challenge. Returns a Promise that resolves when the modal
   * sees the N1CO `authentication.complete` postMessage, OR when the user
   * cancels the modal, OR after `timeoutMs` (default 5 min).
   */
  open(authUrl: string, timeoutMs = 5 * 60 * 1000): Promise<ThreeDSResult> {
    // Reject any in-flight challenge — only one at a time.
    if (this.resolver) {
      this.resolver({ status: 'CANCELLED' });
    }

    this.authUrl = authUrl;
    this.notify();

    return new Promise<ThreeDSResult>((resolve) => {
      const timer = setTimeout(() => {
        this.resolve({ status: 'EXPIRED' });
      }, timeoutMs);

      this.resolver = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
    });
  }

  /** Called by the modal (or the postMessage handler) to complete the challenge. */
  resolve(result: ThreeDSResult): void {
    const r = this.resolver;
    this.resolver = null;
    this.authUrl = null;
    this.notify();
    r?.(result);
  }

  /** Subscribed to by the React modal to know when to mount the iframe. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener({ authUrl: this.authUrl });
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    const state = { authUrl: this.authUrl };
    this.listeners.forEach((l) => l(state));
  }
}

export const ThreeDSChallenge = new ThreeDSChallengeImpl();

export interface N1COMessage {
  MessageType?: string;
  Status?: ThreeDSResult['status'];
  AuthenticationId?: string;
}

export function parseN1COMessage(data: unknown): N1COMessage | null {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as N1COMessage;
    } catch {
      return null;
    }
  }

  if (data && typeof data === 'object') {
    return data as N1COMessage;
  }

  return null;
}

/**
 * Maps an N1CO 3DS iframe message to the challenge outcome, or null to keep waiting.
 * Only the terminal messages end the challenge (N1CO 3DS docs): `authentication.complete`
 * and `authentication.failed`. Intermediate ones — `authentication.verified` (OTP accepted,
 * no Status), `profile.completed` — and a `PENDING` status mean "keep waiting"; resolving on
 * them aborted a payment the user was still completing.
 */
export function resultFromN1COMessage(data: N1COMessage | null): ThreeDSResult | null {
  const type = data?.MessageType;
  if (type !== 'authentication.complete' && type !== 'authentication.failed') return null;
  const status = data?.Status ?? (type === 'authentication.failed' ? 'FAILED' : 'ERROR');
  if (status === 'PENDING') return null;
  return { status, authenticationId: data?.AuthenticationId };
}
