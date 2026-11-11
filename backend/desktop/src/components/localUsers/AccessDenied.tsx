import { useNavigate } from 'react-router-dom';
import { Lock, LogOut } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectActiveLocalUser, selectLocalUsersOwner } from '@/store/selectors/localUsersSelectors';
import { lockLocalSession } from '@/store/slices/localUsersSlice';
import { firstAllowedRoute } from '@/services/localUsers/permissions';

/** Rendered in place of a screen the signed-in local user may not open. */
export function AccessDenied() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectActiveLocalUser);
  const owner = useAppSelector(selectLocalUsersOwner);
  const landing = firstAllowedRoute(user);

  return (
    <Card className="max-w-xl mx-auto mt-10 text-center" data-testid="access-denied">
      <div className="w-14 h-14 mx-auto rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center mb-4">
        <Lock size={26} />
      </div>
      <h2 className="text-xl font-bold text-brand-900 mb-2">Acceso restringido</h2>
      <p className="text-sm text-brand-600 mb-1">
        {landing
          ? 'Tu usuario no tiene permiso para abrir esta pantalla.'
          : 'Tu usuario todavía no tiene pantallas asignadas.'}
      </p>
      <p className="text-xs text-brand-400 mb-5">
        Pide al administrador{owner?.email ? ` (${owner.email})` : ''} que habilite el acceso en
        Configuración → Usuarios.
      </p>
      <div className="flex justify-center gap-2">
        {landing && (
          <Button variant="primary" onClick={() => navigate(landing, { replace: true })} data-testid="access-denied-home">
            Ir a mi inicio
          </Button>
        )}
        <Button
          variant="secondary"
          icon={<LogOut size={16} />}
          onClick={() => dispatch(lockLocalSession())}
          data-testid="access-denied-switch-user"
        >
          Cambiar de usuario
        </Button>
      </div>
    </Card>
  );
}

export default AccessDenied;
