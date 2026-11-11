import { useEffect, useState, useRef } from 'react';
import { X, ShieldCheck } from 'lucide-react';
import {
  ThreeDSChallenge,
  parseN1COMessage,
  resultFromN1COMessage,
} from '@/services/subscription/ThreeDSChallenge';

const N1CO_3DS_ORIGINS = new Set([
  'https://front-3ds.n1co.com',
  'https://front-3ds-sandbox.n1co.com',
]);

/**
 * Renders the N1CO 3DS challenge inside an iframe and listens for the
 * `authentication.complete` postMessage. Mounted at the App root so any
 * thunk calling `N1COService.handle3DS()` triggers it via the
 * `ThreeDSChallenge` singleton.
 *
 * Security:
 *   - Validates `event.origin` against N1CO production/sandbox 3DS origins
 *     before reading the message payload.
 *   - Closing the modal via the X button resolves as CANCELLED.
 */
export function ThreeDSChallengeModal() {
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    return ThreeDSChallenge.subscribe((state) => {
      setAuthUrl(state.authUrl);
    });
  }, []);

  useEffect(() => {
    if (!authUrl) return;

    const handler = (event: MessageEvent) => {
      if (!N1CO_3DS_ORIGINS.has(event.origin)) return;
      const result = resultFromN1COMessage(parseN1COMessage(event.data));
      if (result) ThreeDSChallenge.resolve(result);
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [authUrl]);

  if (!authUrl) return null;

  return (
    <div
      data-testid="threeds-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Autenticación 3D Secure"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-4 py-3 border-b border-brand-100">
          <div className="flex items-center gap-2 text-sm text-brand-700 font-semibold">
            <ShieldCheck size={16} className="text-green-600" />
            <span>Autenticación 3D Secure</span>
          </div>
          <button
            type="button"
            onClick={() => ThreeDSChallenge.resolve({ status: 'CANCELLED' })}
            aria-label="Cerrar"
            data-testid="threeds-modal-close"
            className="p-1 rounded text-brand-400 hover:text-brand-700 hover:bg-brand-100"
          >
            <X size={18} />
          </button>
        </header>
        <iframe
          ref={iframeRef}
          src={authUrl}
          title="N1CO 3D Secure Challenge"
          data-testid="threeds-iframe"
          className="w-full"
          style={{ height: 480, border: 0 }}
          // N1CO needs scripts + same-origin for the issuer's challenge to
          // function. We do NOT allow `allow-top-navigation` so the iframe
          // can't navigate the host away. postMessage from front-3ds.n1co.com
          // is what tells us the challenge completed.
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
        <footer className="px-4 py-2 text-[11px] text-brand-400 border-t border-brand-100">
          Si la página no responde en unos minutos, cierra y vuelve a intentar.
          Tu suscripción se confirmará automáticamente al completar la autenticación.
        </footer>
      </div>
    </div>
  );
}
