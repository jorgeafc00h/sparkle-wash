import { useNavigate } from 'react-router-dom';
import { Link, LogOut, ShieldCheck, User } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useState } from 'react';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import { linkGoogleProvider, logoutUser, logout } from '@/store/slices/authSlice';

export default function ProfilePage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const { user, isGuestMode, linkedProviders, providerLinking, loading } = useAppSelector((s) => s.auth);
  const [showLogout, setShowLogout] = useState(false);
  const hasGoogleProvider = linkedProviders.some((provider) => provider.toLowerCase() === 'google');

  async function handleLogout() {
    await dispatch(logoutUser());
    dispatch(logout());
    toast.info('Sesión cerrada.');
    navigate('/welcome', { replace: true });
  }

  async function handleLinkGoogle() {
    const result = await dispatch(linkGoogleProvider());
    if (linkGoogleProvider.fulfilled.match(result)) {
      toast.success('Google vinculado a tu cuenta.');
      return;
    }
    toast.error(String(result.payload ?? 'No se pudo vincular Google'));
  }

  return (
    <div data-testid="profile" className="max-w-lg mx-auto space-y-6">
      <PageHeader title="Perfil" subtitle="Información de la cuenta" />

      {providerLinking?.required && (
        <Card className="border-amber-200 bg-amber-50" data-testid="profile-provider-linking-message">
          <p className="text-sm font-semibold text-amber-900">Vinculación de cuenta requerida</p>
          <p className="text-sm text-amber-800 mt-1">{providerLinking.message}</p>
        </Card>
      )}

      <Card className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-accent-100 text-accent-600 flex items-center justify-center shrink-0">
          <User size={28} />
        </div>
        <div className="flex-1">
          {isGuestMode ? (
            <>
              <p className="font-semibold text-brand-800">Modo Invitado</p>
              <p className="text-sm text-brand-400">Sin cuenta asociada</p>
              <Badge variant="neutral" size="sm">Invitado</Badge>
            </>
          ) : user ? (
            <>
              <p className="font-semibold text-brand-800">
                {[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Usuario'}
              </p>
              <p className="text-sm text-brand-400">{user.email}</p>
              <Badge variant="success" size="sm">Autenticado</Badge>
            </>
          ) : (
            <p className="text-brand-400">Sin información de usuario.</p>
          )}
        </div>
      </Card>

      {!isGuestMode && user && (
        <Card>
          <h2 className="font-semibold text-brand-800 mb-3">Detalles de la Cuenta</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-brand-500">Correo</dt>
              <dd className="text-brand-800">{user.email}</dd>
            </div>
            {user.firstName && (
              <div className="flex justify-between">
                <dt className="text-brand-500">Nombre</dt>
                <dd className="text-brand-800">{user.firstName} {user.lastName}</dd>
              </div>
            )}
            {user.phone && (
              <div className="flex justify-between">
                <dt className="text-brand-500">Teléfono</dt>
                <dd className="text-brand-800">{user.phone}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      {!isGuestMode && user && (
        <Card className="space-y-4" data-testid="profile-provider-links">
          <div>
            <h2 className="font-semibold text-brand-800">Proveedores vinculados</h2>
            <p className="text-sm text-brand-500 mt-1">
              Agrega métodos de inicio de sesión a esta cuenta.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-100 p-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                <ShieldCheck size={20} className="text-brand-600" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-brand-800">Google</p>
                <p className="text-xs text-brand-500">
                  {hasGoogleProvider ? 'Disponible para iniciar sesión' : 'Vincula Google a tu cuenta actual'}
                </p>
              </div>
            </div>

            {hasGoogleProvider ? (
              <Badge variant="success" size="sm">Vinculado</Badge>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                icon={<Link size={14} />}
                loading={loading}
                onClick={handleLinkGoogle}
                data-testid="profile-link-google"
              >
                Vincular
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card>
        <Button
          variant="danger"
          icon={<LogOut size={16} />}
          onClick={() => setShowLogout(true)}
          className="w-full"
        >
          Cerrar Sesión
        </Button>
      </Card>

      <ConfirmDialog
        isOpen={showLogout}
        onClose={() => setShowLogout(false)}
        onConfirm={handleLogout}
        title="Cerrar Sesión"
        message="¿Estás seguro de que deseas cerrar sesión? Se perderá el estado de la sesión actual."
        confirmLabel="Cerrar Sesión"
        variant="danger"
      />
    </div>
  );
}
