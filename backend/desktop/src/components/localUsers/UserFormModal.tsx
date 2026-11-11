import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_PRESETS,
  ALL_PERMISSIONS,
  SCREEN_PERMISSIONS,
} from '@/services/localUsers/permissions';
import { isValidPin } from '@/services/localUsers/pinHash';
import { findUsernameConflict } from '@/store/slices/localUsersSlice';
import type { LocalUser, ScreenPermission } from '@/types/localUsers';

export interface UserFormValues {
  displayName: string;
  username: string;
  pin: string;
  permissions: ScreenPermission[];
}

interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Edit mode when given (PIN changes go through the reset-PIN dialog). */
  user?: LocalUser | null;
  users: readonly LocalUser[];
  onSubmit: (values: UserFormValues) => void;
}

const slug = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '');

export function UserFormModal({ isOpen, onClose, user, users, onSubmit }: UserFormModalProps) {
  const isEdit = !!user;
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [permissions, setPermissions] = useState<Set<ScreenPermission>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDisplayName(user?.displayName ?? '');
    setUsername(user?.username ?? '');
    setUsernameTouched(isEdit);
    setPin('');
    setPinConfirm('');
    setPermissions(new Set(user?.permissions ?? PERMISSION_PRESETS[0].permissions));
    setSubmitted(false);
  }, [isOpen, user, isEdit]);

  const errors = useMemo(() => {
    const result: Partial<Record<'displayName' | 'username' | 'pin' | 'pinConfirm' | 'permissions', string>> = {};
    if (!displayName.trim()) result.displayName = 'Escribe el nombre';
    if (!username.trim()) result.username = 'Escribe un usuario';
    else if (!/^[a-z0-9._-]{2,32}$/.test(username.trim().toLowerCase())) {
      result.username = 'Solo letras, números, punto, guion (2–32)';
    } else if (findUsernameConflict(users, username, user?.id)) {
      result.username = 'Ese usuario ya existe';
    }
    if (!isEdit) {
      if (!isValidPin(pin)) result.pin = 'El PIN debe tener de 4 a 8 dígitos';
      else if (pin !== pinConfirm) result.pinConfirm = 'Los PIN no coinciden';
    }
    // Action permissions (e.g. "Anular tickets") open no screen on their own.
    if (user?.role !== 'admin' && !SCREEN_PERMISSIONS.some((key) => permissions.has(key))) {
      result.permissions = 'Selecciona al menos una pantalla';
    }
    return result;
  }, [displayName, username, pin, pinConfirm, permissions, users, user, isEdit]);

  const hasErrors = Object.keys(errors).length > 0;

  function toggle(permission: ScreenPermission) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  function handleSubmit() {
    setSubmitted(true);
    if (hasErrors) return;
    onSubmit({
      displayName: displayName.trim(),
      username: username.trim().toLowerCase(),
      pin,
      permissions: ALL_PERMISSIONS.filter((key) => permissions.has(key)),
    });
  }

  const showError = (key: keyof typeof errors) => (submitted ? errors[key] : undefined);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? `Editar ${user?.displayName}` : 'Nuevo usuario'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} data-testid="user-form-cancel">
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSubmit} data-testid="user-form-save">
            {isEdit ? 'Guardar cambios' : 'Crear usuario'}
          </Button>
        </>
      }
    >
      <div className="space-y-5" data-testid="user-form">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Nombre"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              if (!usernameTouched) setUsername(slug(e.target.value.split(' ')[0] ?? ''));
            }}
            placeholder="Ej. María López"
            error={showError('displayName')}
            id="user-form-name"
            data-testid="user-form-name"
            required
          />
          <Input
            label="Usuario"
            value={username}
            onChange={(e) => {
              setUsername(slug(e.target.value));
              setUsernameTouched(true);
            }}
            placeholder="maria"
            error={showError('username')}
            helperText="Se muestra en la pantalla de acceso"
            id="user-form-username"
            data-testid="user-form-username"
            required
          />
          {!isEdit && (
            <>
              <Input
                label="PIN"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                error={showError('pin')}
                helperText="4 a 8 dígitos"
                id="user-form-pin"
            data-testid="user-form-pin"
                required
              />
              <Input
                label="Confirmar PIN"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))}
                error={showError('pinConfirm')}
                id="user-form-pin-confirm"
            data-testid="user-form-pin-confirm"
                required
              />
            </>
          )}
        </div>

        {user?.role === 'admin' ? (
          <p className="text-sm text-brand-500 rounded-lg bg-brand-50 p-3">
            El administrador tiene acceso a todas las pantallas y administra los usuarios.
          </p>
        ) : (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p className="text-sm font-medium text-brand-700">Pantallas permitidas</p>
              <div className="flex flex-wrap gap-1.5">
                {PERMISSION_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setPermissions(new Set(preset.permissions))}
                    data-testid={`user-form-preset-${preset.id}`}
                    className="rounded-full border border-brand-200 px-2.5 py-1 text-xs text-brand-600 hover:border-accent-400 hover:text-accent-700"
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPermissions(new Set(ALL_PERMISSIONS))}
                  data-testid="user-form-preset-all"
                  className="rounded-full border border-brand-200 px-2.5 py-1 text-xs text-brand-600 hover:border-accent-400 hover:text-accent-700"
                >
                  Todas
                </button>
                <button
                  type="button"
                  onClick={() => setPermissions(new Set())}
                  data-testid="user-form-preset-none"
                  className="rounded-full border border-brand-200 px-2.5 py-1 text-xs text-brand-600 hover:border-accent-400 hover:text-accent-700"
                >
                  Ninguna
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PERMISSION_GROUPS.map((group) => (
                <fieldset key={group} className="rounded-lg border border-brand-100 p-3">
                  <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-brand-500">{group}</legend>
                  <div className="space-y-1.5">
                    {PERMISSIONS.filter((permission) => permission.group === group).map((permission) => (
                      <label key={permission.key} className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={permissions.has(permission.key)}
                          onChange={() => toggle(permission.key)}
                          data-testid={`user-form-perm-${permission.key}`}
                          className="mt-0.5 h-4 w-4 rounded border-brand-300 text-accent-600 focus:ring-accent-500"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm text-brand-800">{permission.label}</span>
                          <span className="block text-xs text-brand-400">{permission.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            {showError('permissions') && <p className="mt-2 text-sm text-red-600">{errors.permissions}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default UserFormModal;
