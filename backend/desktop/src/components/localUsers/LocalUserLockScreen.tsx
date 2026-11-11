import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { useToast } from '@/components/common/Toast';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { selectLocalUsers, selectLocalUsersOwner } from '@/store/selectors/localUsersSelectors';
import { localSessionStarted, unlockLocalUser } from '@/store/slices/localUsersSlice';
import GoogleAuthService from '@/services/auth/GoogleAuthService';
import { appStorage } from '@/services/storage/ElectronStorage';
import { canAccessPath, firstAllowedRoute } from '@/services/localUsers/permissions';
import type { LocalUser } from '@/types/localUsers';
import { UserAvatar } from './UserAvatar';

const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30_000;
// Failure counters + cooldowns persist (appStorage) so Ctrl+R / a relaunch
// doesn't reset the brute-force limit.
const LOCKOUT_KEY = 'fs_local_pin_lockout';

type LockoutState = { failures: Record<string, number>; lockedUntil: Record<string, number> };

async function loadLockout(): Promise<LockoutState> {
  try {
    const raw = await appStorage.getItem(LOCKOUT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<LockoutState>) : {};
    return { failures: parsed.failures ?? {}, lockedUntil: parsed.lockedUntil ?? {} };
  } catch {
    return { failures: {}, lockedUntil: {} };
  }
}

function saveLockout(state: LockoutState): void {
  void appStorage.setItem(LOCKOUT_KEY, JSON.stringify(state)).catch(() => undefined);
}

/**
 * Full-screen "¿Quién está usando la app?" gate shown while user control is on
 * and nobody is signed in locally (always the case at startup).
 */
export function LocalUserLockScreen() {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const users = useAppSelector(selectLocalUsers);
  const owner = useAppSelector(selectLocalUsersOwner);
  const company = useAppSelector(selectCurrentCompany);

  const activeUsers = useMemo(() => users.filter((user) => user.isActive), [users]);
  const [selected, setSelected] = useState<LocalUser | null>(activeUsers.length === 1 ? activeUsers[0] : null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, number>>({});
  const [lockedUntil, setLockedUntil] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [googleBusy, setGoogleBusy] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);
  const lockoutLoaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadLockout().then((state) => {
      if (cancelled) return;
      lockoutLoaded.current = true;
      setFailures((prev) => ({ ...state.failures, ...prev }));
      setLockedUntil((prev) => ({ ...state.lockedUntil, ...prev }));
      setNow(Date.now());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (lockoutLoaded.current) saveLockout({ failures, lockedUntil });
  }, [failures, lockedUntil]);

  const cooldownEnds = selected ? lockedUntil[selected.id] ?? 0 : 0;
  const coolingDown = cooldownEnds > now;

  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [coolingDown]);

  useEffect(() => {
    if (selected) pinRef.current?.focus();
  }, [selected]);

  // The previous user may have locked on a screen the next one can't open
  // (e.g. the admin on Usuarios, then the cashier signs in): land them on
  // their own first screen instead of "Acceso restringido".
  function landOnPermittedScreen(user: LocalUser) {
    if (canAccessPath(user, location.pathname)) return;
    const landing = firstAllowedRoute(user);
    if (landing) navigate(landing, { replace: true });
  }

  function choose(user: LocalUser) {
    setSelected(user);
    setPin('');
    setError(null);
  }

  function submit() {
    if (!selected || !pin || coolingDown) return;
    // A thunk verifies the PIN against the store, so the PIN never enters an action.
    const ok = dispatch(unlockLocalUser(selected.id, pin));
    if (ok) {
      setFailures((prev) => ({ ...prev, [selected.id]: 0 }));
      landOnPermittedScreen(selected);
      return;
    }
    const count = (failures[selected.id] ?? 0) + 1;
    setFailures((prev) => ({ ...prev, [selected.id]: count }));
    setPin('');
    if (count >= MAX_ATTEMPTS) {
      setLockedUntil((prev) => ({ ...prev, [selected.id]: Date.now() + COOLDOWN_MS }));
      setFailures((prev) => ({ ...prev, [selected.id]: 0 }));
      setNow(Date.now());
      setError(`Demasiados intentos. Espera ${COOLDOWN_MS / 1000} segundos.`);
    } else {
      setError(`PIN incorrecto (${count}/${MAX_ATTEMPTS})`);
    }
    pinRef.current?.focus();
  }

  async function unlockWithGoogle(admin: LocalUser) {
    if (!owner) return;
    setGoogleBusy(true);
    try {
      // Identity proof only: a cashier trying their own Google account must not
      // become the app's Google session (Drive/Gmail would follow it).
      const { user: googleUser } = await GoogleAuthService.authorize({
        loginHint: owner.email,
        updateSession: 'never',
      });
      if (googleUser.email.trim().toLowerCase() !== owner.email.trim().toLowerCase()) {
        setError(`La cuenta ${googleUser.email} no es la administradora (${owner.email}).`);
        return;
      }
      dispatch(localSessionStarted({ userId: admin.id, at: new Date().toISOString(), method: 'google' }));
      toast.success('Sesión iniciada con Google. Puedes cambiar tu PIN en Configuración → Usuarios.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión con Google');
    } finally {
      setGoogleBusy(false);
    }
  }

  const secondsLeft = Math.max(0, Math.ceil((cooldownEnds - now) / 1000));

  return (
    <div
      data-testid="local-lock-screen"
      className="fixed inset-0 z-40 flex items-center justify-center bg-brand-900 p-6 overflow-y-auto"
    >
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 w-12 h-12 rounded-xl bg-accent-600 text-white flex items-center justify-center">
            <Lock size={22} />
          </div>
          <h1 className="text-2xl font-semibold text-white">
            {selected ? `Hola, ${selected.displayName}` : '¿Quién está usando la app?'}
          </h1>
          <p className="mt-1 text-sm text-brand-400">
            {company?.nombreComercial || company?.nombre || 'SparkleWash'}
          </p>
        </div>

        {!selected ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="lock-user-list">
            {activeUsers.map((user) => (
              <button
                key={user.id}
                type="button"
                data-testid={`lock-user-${user.username}`}
                onClick={() => choose(user)}
                className="flex flex-col items-center gap-2 rounded-xl border border-brand-700 bg-white/5 px-4 py-5 text-center hover:bg-white/10 hover:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors"
              >
                <UserAvatar name={user.displayName} size="lg" admin={user.role === 'admin'} />
                <span className="text-sm font-medium text-white truncate max-w-full">{user.displayName}</span>
                <span className="text-[11px] uppercase tracking-wider text-brand-400">
                  {user.role === 'admin' ? 'Administrador' : `@${user.username}`}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mx-auto max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-5">
              <UserAvatar name={selected.displayName} admin={selected.role === 'admin'} />
              <div className="min-w-0">
                <p className="font-semibold text-brand-900 truncate">{selected.displayName}</p>
                <p className="text-xs text-brand-500">
                  {selected.role === 'admin' ? 'Administrador' : `@${selected.username}`}
                </p>
              </div>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <label htmlFor="lock-pin" className="block text-sm font-medium text-brand-700 mb-1">
                PIN
              </label>
              <input
                id="lock-pin"
                ref={pinRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                value={pin}
                disabled={coolingDown}
                onChange={(event) => {
                  setPin(event.target.value.replace(/\D/g, ''));
                  setError(null);
                }}
                data-testid="lock-pin-input"
                className="w-full rounded-lg border border-brand-300 px-3 py-2.5 text-center text-xl tracking-[0.5em] text-brand-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-200 disabled:bg-brand-50"
              />
              {(error || coolingDown) && (
                <p className="mt-2 text-sm text-red-600" data-testid="lock-error" role="alert">
                  {coolingDown ? `Demasiados intentos. Intenta de nuevo en ${secondsLeft} s.` : error}
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                className="w-full mt-4"
                icon={<KeyRound size={16} />}
                disabled={!pin || coolingDown}
                data-testid="lock-submit"
              >
                Entrar
              </Button>
            </form>

            {selected.role === 'admin' && owner && (
              <button
                type="button"
                onClick={() => void unlockWithGoogle(selected)}
                disabled={googleBusy}
                data-testid="lock-google-unlock"
                className="mt-3 w-full inline-flex items-center justify-center gap-2 text-sm text-accent-600 hover:text-accent-700 disabled:opacity-60"
              >
                <ShieldCheck size={15} />
                {googleBusy ? 'Abriendo Google…' : `¿Olvidaste el PIN? Entrar con ${owner.email}`}
              </button>
            )}

            {activeUsers.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setError(null);
                }}
                data-testid="lock-change-user"
                className="mt-4 w-full inline-flex items-center justify-center gap-1.5 text-sm text-brand-500 hover:text-brand-700"
              >
                <ArrowLeft size={14} />
                Cambiar de usuario
              </button>
            )}
          </div>
        )}

        {owner && (
          <p className="mt-8 text-center text-xs text-brand-500">
            Usuarios administrados por <span className="text-brand-300">{owner.email}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export default LocalUserLockScreen;
