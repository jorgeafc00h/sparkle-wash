import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import GoogleAuthService from '@/services/auth/GoogleAuthService';

/**
 * Shown while the user completes Google sign-in in the system browser. The
 * app cannot see that browser tab, so this is where the user cancels the
 * attempt or reopens the Google page if they closed it.
 */
export function GoogleSignInPendingDialog() {
  const [pending, setPending] = useState(() => GoogleAuthService.isSignInPending());

  useEffect(() => GoogleAuthService.onSignInPendingChange(setPending), []);

  const cancel = () => {
    void GoogleAuthService.cancelPendingSignIn();
  };

  return (
    <Modal
      isOpen={pending}
      onClose={cancel}
      title="Continúa en tu navegador"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={cancel} data-testid="google-signin-cancel">
            Cancelar
          </Button>
          <Button
            variant="secondary"
            icon={<ExternalLink className="w-4 h-4" />}
            onClick={() => void GoogleAuthService.reopenPendingSignIn()}
            data-testid="google-signin-reopen"
          >
            Abrir de nuevo
          </Button>
        </>
      }
    >
      <div data-testid="google-signin-pending" className="space-y-2 text-sm text-brand-700">
        <p>Abrimos la página de inicio de sesión de Google en tu navegador.</p>
        <p>Elige tu cuenta, acepta los permisos y luego vuelve a Car Spa.</p>
      </div>
    </Modal>
  );
}

export default GoogleSignInPendingDialog;
