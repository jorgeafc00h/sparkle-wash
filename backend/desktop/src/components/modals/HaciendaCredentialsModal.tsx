import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Info } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { SecureStorageService } from '@/services/security/SecureStorageService';

export interface HaciendaCredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (credentials: { user: string; password: string }) => void;
  companyNit: string;
  initialUser?: string;
}

export function HaciendaCredentialsModal({
  isOpen,
  onClose,
  onSave,
  companyNit,
  initialUser = '',
}: HaciendaCredentialsModalProps) {
  const [user, setUser] = useState(initialUser);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ user?: string; password?: string }>({});

  // Pre-populate user when modal opens
  useEffect(() => {
    if (isOpen) {
      setUser(initialUser);
      setPassword('');
      setErrors({});
      setShowPassword(false);
    }
  }, [isOpen, initialUser]);

  function validate(): boolean {
    const newErrors: { user?: string; password?: string } = {};
    if (!user.trim()) newErrors.user = 'El usuario es requerido';
    if (!password.trim()) newErrors.password = 'La contraseña es requerida';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      await SecureStorageService.storeCredentials(companyNit, { user: user.trim(), password });
      onSave({ user: user.trim(), password });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Credenciales Ministerio de Hacienda"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Info banner */}
        <div className="flex gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5">
          <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            Estas credenciales son necesarias para enviar DTEs al Ministerio de Hacienda.
            Se almacenan de forma segura en tu dispositivo.
          </p>
        </div>

        <Input
          label="Usuario MH"
          placeholder="Usuario del portal de Hacienda"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          error={errors.user}
          required
          autoComplete="username"
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-brand-700">
            Contraseña MH <span className="text-error ml-1">*</span>
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Contraseña del portal de Hacienda"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              className={[
                'w-full rounded-lg border px-3 py-2 pr-10 text-sm text-brand-900 bg-white',
                'placeholder:text-brand-400 transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500',
                errors.password
                  ? 'border-error focus:ring-error'
                  : 'border-brand-300 hover:border-brand-400',
              ].join(' ')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-brand-400 hover:text-brand-600 transition-colors"
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.password && (
            <p className="text-xs text-error">{errors.password}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default HaciendaCredentialsModal;
