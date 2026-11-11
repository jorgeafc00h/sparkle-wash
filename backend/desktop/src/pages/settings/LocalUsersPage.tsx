import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  History,
  KeyRound,
  LogIn,
  Pencil,
  Plus,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { AlertBanner } from '@/components/common/AlertBanner';
import { useToast } from '@/components/common/Toast';
import { UserAvatar } from '@/components/localUsers/UserAvatar';
import { UserFormModal, type UserFormValues } from '@/components/localUsers/UserFormModal';
import { PinSetModal } from '@/components/localUsers/PinSetModal';
import { useAppDispatch, useAppSelector } from '@/store';
import {
  selectActiveLocalUser,
  selectLocalUsers,
  selectLocalUsersEnabled,
  selectLocalUsersOwner,
} from '@/store/selectors/localUsersSelectors';
import {
  addLocalUser,
  deleteLocalUser,
  disableLocalUsers,
  enableLocalUsers,
  resetLocalUserPin,
  updateLocalUser,
} from '@/store/slices/localUsersSlice';
import { googleSignIn } from '@/store/slices/authSlice';
import { ALL_PERMISSIONS, PERMISSIONS } from '@/services/localUsers/permissions';
import type { LocalUser } from '@/types/localUsers';

const dateTime = new Intl.DateTimeFormat('es-SV', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const formatDateTime = (iso?: string) => (iso ? dateTime.format(new Date(iso)) : '—');

const PERMISSION_LABEL = new Map(PERMISSIONS.map((permission) => [permission.key, permission.label]));

function permissionSummary(user: LocalUser): string {
  if (user.role === 'admin') return 'Todas las pantallas';
  if (user.permissions.length === ALL_PERMISSIONS.length) return 'Todas las pantallas';
  if (user.permissions.length === 0) return 'Sin pantallas';
  const labels = user.permissions.map((key) => PERMISSION_LABEL.get(key) ?? key);
  return labels.length <= 3 ? labels.join(', ') : `${labels.slice(0, 3).join(', ')} y ${labels.length - 3} más`;
}

/**
 * Configuración → Usuarios. Local users for internal control: the Gmail account
 * that enables it is the administrator; every user it creates is linked to that
 * account, unlocks the app with a PIN and only sees the screens granted here.
 */
export default function LocalUsersPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const authUser = useAppSelector((state) => state.auth.user);
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const authLoading = useAppSelector((state) => state.auth.loading);
  const enabled = useAppSelector(selectLocalUsersEnabled);
  const owner = useAppSelector(selectLocalUsersOwner);
  const users = useAppSelector(selectLocalUsers);
  const activeUser = useAppSelector(selectActiveLocalUser);

  const [enableOpen, setEnableOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LocalUser | null>(null);
  const [pinTarget, setPinTarget] = useState<LocalUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LocalUser | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);

  const ownerName = authUser ? `${authUser.firstName ?? ''} ${authUser.lastName ?? ''}`.trim() : '';
  const signedInAsOther =
    enabled && owner && isAuthenticated && authUser?.email &&
    authUser.email.trim().toLowerCase() !== owner.email.trim().toLowerCase();

  const counts = useMemo(
    () => ({
      total: users.length,
      active: users.filter((user) => user.isActive).length,
    }),
    [users],
  );

  async function handleGoogleSignIn() {
    const result = await dispatch(googleSignIn());
    if (googleSignIn.rejected.match(result)) {
      toast.error(result.payload ?? 'No se pudo iniciar sesión con Google');
    }
  }

  function handleEnable(pin: string) {
    if (!authUser?.email) return;
    dispatch(
      enableLocalUsers({
        owner: { googleUserId: authUser.id, email: authUser.email, name: ownerName || authUser.email },
        pin,
      }),
    );
    setEnableOpen(false);
    toast.success('Control de usuarios activado. Ya puedes crear usuarios.');
  }

  function handleSaveUser(values: UserFormValues) {
    if (editing) {
      dispatch(
        updateLocalUser({
          id: editing.id,
          displayName: values.displayName,
          username: values.username,
          permissions: editing.role === 'admin' ? undefined : values.permissions,
        }),
      );
      toast.success(`Usuario ${values.displayName} actualizado`);
    } else {
      dispatch(addLocalUser(values));
      toast.success(`Usuario ${values.displayName} creado`);
    }
    setFormOpen(false);
    setEditing(null);
  }

  function handleResetPin(pin: string) {
    if (!pinTarget) return;
    dispatch(resetLocalUserPin({ id: pinTarget.id, pin }));
    toast.success(pinTarget.id === activeUser?.id ? 'Tu PIN fue actualizado' : `PIN de ${pinTarget.displayName} restablecido`);
    setPinTarget(null);
  }

  function handleToggleActive(user: LocalUser) {
    dispatch(updateLocalUser({ id: user.id, isActive: !user.isActive }));
    toast.success(user.isActive ? `${user.displayName} ya no puede ingresar` : `${user.displayName} reactivado`);
  }

  function handleDelete() {
    if (!deleteTarget) return;
    dispatch(deleteLocalUser(deleteTarget.id));
    toast.success(`Usuario ${deleteTarget.displayName} eliminado`);
    setDeleteTarget(null);
  }

  function handleDisable() {
    dispatch(disableLocalUsers());
    setDisableOpen(false);
    toast.success('Control de usuarios desactivado');
  }

  return (
    <div data-testid="local-users-page" className="space-y-5 max-w-5xl">
      <PageHeader
        title="Usuarios y permisos"
        subtitle="Usuarios locales de esta instalación, vinculados a tu cuenta de Google"
        onBack={() => navigate('/settings')}
        actions={
          enabled ? (
            <>
              <Button
                variant="secondary"
                icon={<History size={16} />}
                onClick={() => navigate('/settings/audit')}
                data-testid="btn-open-audit-log"
              >
                Historial de actividad
              </Button>
              <Button
                variant="primary"
                icon={<Plus size={16} />}
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                data-testid="btn-new-local-user"
              >
                Nuevo usuario
              </Button>
            </>
          ) : undefined
        }
      />

      {!enabled && (
        <Card className="space-y-4" data-testid="local-users-intro">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 shrink-0 rounded-xl bg-accent-50 text-accent-600 flex items-center justify-center">
              <Users size={24} />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-brand-900">Control de usuarios</h2>
              <p className="text-sm text-brand-600">
                Crea usuarios para las personas que comparten esta computadora (cajeros, facturación,
                contador). Cada uno entra con su PIN, solo ve las pantallas que le asignes y la app registra
                quién creó y quién modificó cada factura, cliente, producto, venta y compra.
              </p>
              <ul className="text-sm text-brand-500 list-disc pl-5 space-y-0.5">
                <li>Tu cuenta de Google será el <strong>administrador</strong>: ve y administra todo.</li>
                <li>Los usuarios y el historial de actividad se guardan solo en esta computadora; no se envían a Hacienda ni a la nube.</li>
                <li>Al abrir la app se pedirá elegir usuario e ingresar el PIN.</li>
              </ul>
            </div>
          </div>

          {isAuthenticated && authUser?.email ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-brand-50 p-4">
              <div className="flex items-center gap-3 min-w-0">
                <UserAvatar name={ownerName || authUser.email} admin />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-900 truncate">{ownerName || authUser.email}</p>
                  <p className="text-xs text-brand-500 truncate" data-testid="local-users-owner-email">{authUser.email}</p>
                </div>
              </div>
              <Button
                variant="primary"
                icon={<ShieldCheck size={16} />}
                onClick={() => setEnableOpen(true)}
                data-testid="btn-enable-local-users"
              >
                Activar con esta cuenta
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 border border-amber-200 p-4" data-testid="local-users-requires-google">
              <p className="text-sm text-amber-800">
                Inicia sesión con tu cuenta de Google para activar el control de usuarios: esa cuenta será el administrador.
              </p>
              <Button
                variant="primary"
                icon={<LogIn size={16} />}
                onClick={() => void handleGoogleSignIn()}
                loading={authLoading}
                data-testid="btn-local-users-google-signin"
              >
                Iniciar sesión con Google
              </Button>
            </div>
          )}
        </Card>
      )}

      {enabled && owner && (
        <>
          {signedInAsOther && (
            <AlertBanner
              type="warning"
              message={`Los usuarios de esta computadora pertenecen a ${owner.email}. La sesión de Google actual (${authUser?.email}) no los administra.`}
            />
          )}

          <Card className="flex flex-wrap items-center justify-between gap-3" data-testid="local-users-owner">
            <div className="flex items-center gap-3 min-w-0">
              <UserAvatar name={owner.name || owner.email} admin />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-brand-400">Cuenta administradora</p>
                <p className="text-sm font-semibold text-brand-900 truncate">{owner.name || owner.email}</p>
                <p className="text-xs text-brand-500 truncate" data-testid="local-users-owner-email">{owner.email}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">{counts.active} de {counts.total} activos</Badge>
              <Button
                variant="ghost"
                size="sm"
                icon={<ShieldOff size={14} />}
                onClick={() => setDisableOpen(true)}
                data-testid="btn-disable-local-users"
              >
                Desactivar control
              </Button>
            </div>
          </Card>

          <Card padding="none" className="overflow-hidden">
            <table className="w-full text-sm" data-testid="local-users-table">
              <thead className="bg-brand-50 text-left text-xs uppercase tracking-wider text-brand-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Usuario</th>
                  <th className="px-4 py-3 font-semibold">Acceso</th>
                  <th className="px-4 py-3 font-semibold">Último ingreso</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100">
                {users.map((user) => (
                  <tr key={user.id} data-testid={`local-user-row-${user.username}`} className={user.isActive ? '' : 'opacity-60'}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <UserAvatar name={user.displayName} size="sm" admin={user.role === 'admin'} />
                        <div className="min-w-0">
                          <p className="font-medium text-brand-900 truncate">
                            {user.displayName}
                            {user.id === activeUser?.id && <span className="ml-2 text-xs text-accent-600">(tú)</span>}
                          </p>
                          <p className="text-xs text-brand-500">@{user.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <Badge variant={user.role === 'admin' ? 'purple' : 'neutral'} size="sm">
                          {user.role === 'admin' ? 'Administrador' : 'Usuario'}
                        </Badge>
                        <span className="text-xs text-brand-500" data-testid={`local-user-access-${user.username}`}>
                          {permissionSummary(user)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-brand-600 whitespace-nowrap">{formatDateTime(user.lastLoginAt)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={user.isActive ? 'success' : 'neutral'} size="sm">
                        {user.isActive ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconButton
                          title="Editar"
                          testId={`local-user-edit-${user.username}`}
                          onClick={() => {
                            setEditing(user);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil size={15} />
                        </IconButton>
                        <IconButton
                          title={user.id === activeUser?.id ? 'Cambiar mi PIN' : 'Restablecer PIN'}
                          testId={`local-user-pin-${user.username}`}
                          onClick={() => setPinTarget(user)}
                        >
                          <KeyRound size={15} />
                        </IconButton>
                        {user.role !== 'admin' && (
                          <>
                            <IconButton
                              title={user.isActive ? 'Desactivar' : 'Reactivar'}
                              testId={`local-user-toggle-${user.username}`}
                              onClick={() => handleToggleActive(user)}
                            >
                              {user.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                            </IconButton>
                            <IconButton
                              title="Eliminar"
                              testId={`local-user-delete-${user.username}`}
                              onClick={() => setDeleteTarget(user)}
                              danger
                            >
                              <Trash2 size={15} />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 1 && (
              <p className="px-4 py-4 text-sm text-brand-500 border-t border-brand-100" data-testid="local-users-only-admin">
                Solo existe el administrador. Usa «Nuevo usuario» para agregar a tu equipo.
              </p>
            )}
          </Card>
        </>
      )}

      <PinSetModal
        isOpen={enableOpen}
        onClose={() => setEnableOpen(false)}
        title="PIN del administrador"
        description={`Elige el PIN con el que ${authUser?.email ?? 'tu cuenta'} entrará como administrador. Si lo olvidas podrás entrar con tu cuenta de Google.`}
        confirmLabel="Activar control de usuarios"
        onSubmit={handleEnable}
      />

      <UserFormModal
        isOpen={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        user={editing}
        users={users}
        onSubmit={handleSaveUser}
      />

      <PinSetModal
        isOpen={!!pinTarget}
        onClose={() => setPinTarget(null)}
        title={pinTarget?.id === activeUser?.id ? 'Cambiar mi PIN' : `Restablecer PIN de ${pinTarget?.displayName ?? ''}`}
        onSubmit={handleResetPin}
      />

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Eliminar usuario"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button variant="danger" onClick={handleDelete} data-testid="confirm-delete-local-user">Eliminar</Button>
          </>
        }
      >
        <p className="text-sm text-brand-600">
          {deleteTarget?.displayName} ya no podrá ingresar. Su nombre se conserva en el historial de actividad y en los
          registros que creó o modificó. Si solo quieres bloquear el acceso temporalmente, usa «Desactivar».
        </p>
      </Modal>

      <Modal
        isOpen={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="Desactivar control de usuarios"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDisableOpen(false)}>Cancelar</Button>
            <Button variant="danger" onClick={handleDisable} data-testid="confirm-disable-local-users">Desactivar</Button>
          </>
        }
      >
        <p className="text-sm text-brand-600">
          La app dejará de pedir PIN y cualquier persona tendrá acceso completo. Los usuarios y el historial de actividad
          se conservan: al volver a activarlo con la misma cuenta se restauran.
        </p>
      </Modal>
    </div>
  );
}

function IconButton({
  title,
  testId,
  onClick,
  danger = false,
  children,
}: {
  title: string;
  testId: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      data-testid={testId}
      className={[
        'p-1.5 rounded-md transition-colors',
        danger ? 'text-red-500 hover:bg-red-50' : 'text-brand-500 hover:bg-brand-100 hover:text-brand-800',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
