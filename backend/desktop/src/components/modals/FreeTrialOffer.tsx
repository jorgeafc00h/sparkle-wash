import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gift } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { useAppDispatch, useAppSelector } from '@/store';
import { startSyncTrial } from '@/store/slices/subscriptionSlice';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import { resolveSyncTrialView, TRIAL_INCLUDES } from '@/services/subscription/SyncTrialService';

/**
 * "Iniciar prueba gratis de 2 meses" for any paid-gated screen. The trial is
 * server-owned (POST /api/auth/sync-trial) and raises the tier to Pro+Sync, so the
 * locked screen unlocks as soon as the thunk resolves. Renders nothing when the
 * offer does not apply (already on a paid tier, trial running, or trial used).
 */
export function FreeTrialOffer({ className = '' }: { className?: string }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const tier = useAppSelector(selectCurrentTier);
  const signedIn = useAppSelector((s) => s.auth.isAuthenticated);
  const starting = useAppSelector((s) => s.subscription.trialStarting);
  const used = useAppSelector((s) => s.subscription.syncTrialUsed);
  const trialUntil = useAppSelector((s) => s.subscription.accountEntitlement?.trialUntil ?? null);
  const [error, setError] = useState<string | null>(null);

  const view = resolveSyncTrialView({ tier, trialUntil, syncTrialUsed: used });

  if (view.showUsed) {
    return (
      <p data-testid="trial-offer-used" className={`text-sm text-brand-500 ${className}`}>
        Ya usaste tu prueba gratis
      </p>
    );
  }
  if (!view.showOffer) return null;

  function start() {
    if (!signedIn) {
      navigate('/settings/account');
      return;
    }
    setError(null);
    dispatch(startSyncTrial())
      .unwrap()
      .catch((err: unknown) =>
        setError(typeof err === 'string' ? err : 'No se pudo iniciar la prueba gratis. Inténtalo de nuevo más tarde.'),
      );
  }

  return (
    <div data-testid="trial-offer" className={`flex flex-col items-center gap-2 ${className}`}>
      <Button data-testid="trial-offer-start" disabled={starting} onClick={start}>
        <Gift size={16} className="mr-2 inline" />
        {starting ? 'Iniciando…' : 'Iniciar prueba gratis de 2 meses'}
      </Button>
      <p className="text-xs text-brand-400">Sin tarjeta · 60 días con todas las funciones de pago:</p>
      <ul className="text-xs text-brand-500 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 text-left">
        {TRIAL_INCLUDES.map((f) => (
          <li key={f}>✓ {f}</li>
        ))}
      </ul>
      {error ? (
        <p data-testid="trial-offer-error" className="text-sm text-red-600 max-w-md">{error}</p>
      ) : null}
    </div>
  );
}

export default FreeTrialOffer;
