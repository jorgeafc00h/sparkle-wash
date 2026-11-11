// "Configuración de caja" (POS Phase 2 design §1 and §4): this device's
// register name and code, and the scale-label (EAN-13) format. Stored in the
// per-company, per-device PosSettings — never synced, so each register keeps
// its own code (C1, C2…) and scale configuration.

import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import {
  normalizeRegisterName,
  registerSettingsOf,
  scaleSettingsOf,
  type PosSettings,
} from '@/services/tickets/PosSettingsStore';
import { formatTicketNumber, normalizeRegisterCode } from '@/services/tickets/ticketNumber';
import {
  buildScaleBarcode,
  validateScaleBarcodeSettings,
  type ScaleBarcodeSettings,
} from '@/services/tickets/scaleBarcode';

interface RegisterSettingsModalProps {
  isOpen: boolean;
  settings: PosSettings;
  onClose: () => void;
  onSave: (next: PosSettings) => Promise<void> | void;
}

export function RegisterSettingsModal({ isOpen, settings, onClose, onSave }: RegisterSettingsModalProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [scale, setScale] = useState<ScaleBarcodeSettings>(scaleSettingsOf(settings));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const register = registerSettingsOf(settings);
    setName(register.name);
    setCode(register.code);
    setScale(scaleSettingsOf(settings));
  }, [isOpen, settings]);

  const scaleError = scale.enabled ? validateScaleBarcodeSettings(scale) : null;
  const example = useMemo(() => {
    if (!scale.enabled || scaleError) return null;
    return buildScaleBarcode(scale, 123, scale.valueKind === 'weight' ? 1250 : 1599);
  }, [scale, scaleError]);

  const save = async () => {
    if (scaleError) return;
    setSaving(true);
    try {
      const normalizedCode = normalizeRegisterCode(code);
      await onSave({
        ...settings,
        registerName: normalizeRegisterName(name),
        registerCode: normalizedCode || undefined,
        scaleBarcodes: scale,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const numberPreview = formatTicketNumber({ sequential: 123, registerCode: normalizeRegisterCode(code) });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Configuración de caja"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button data-testid="btn-register-settings-save" loading={saving} disabled={!!scaleError} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-5" data-testid="register-settings">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-brand-900">Esta caja</h3>
          <p className="text-xs text-slate-500">
            Cada computadora es una caja. Si tienes más de una, dale a cada una su código: el número del ticket
            lo lleva delante y el cierre Z de cada caja incluye solo sus ventas.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Input
                data-testid="register-name"
                label="Nombre"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 40))}
                placeholder="Caja 1"
              />
            </div>
            <Input
              data-testid="register-code"
              label="Código"
              value={code}
              onChange={(e) => setCode(normalizeRegisterCode(e.target.value))}
              placeholder="C1"
            />
          </div>
          <p className="text-xs text-slate-500" data-testid="register-number-preview">
            Así se verá el ticket: <span className="font-mono font-semibold">{numberPreview}</span>
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-brand-900">Etiquetas de balanza</h3>
          <label className="flex items-center gap-2 text-sm text-brand-700">
            <input
              type="checkbox"
              data-testid="scale-enabled"
              checked={scale.enabled}
              onChange={(e) => setScale((s) => ({ ...s, enabled: e.target.checked }))}
            />
            Leer etiquetas de balanza (EAN-13 con peso o precio)
          </label>
          {scale.enabled && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  data-testid="scale-prefix"
                  label="Prefijo"
                  value={scale.prefix}
                  inputMode="numeric"
                  maxLength={2}
                  onChange={(e) => setScale((s) => ({ ...s, prefix: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
                />
                <Select
                  data-testid="scale-value-kind"
                  label="La etiqueta trae"
                  value={scale.valueKind}
                  options={[
                    { label: 'Peso (gramos)', value: 'weight' },
                    { label: 'Precio (centavos)', value: 'price' },
                  ]}
                  onChange={(e) => setScale((s) => ({ ...s, valueKind: e.target.value as 'weight' | 'price' }))}
                />
                <Input
                  data-testid="scale-plu-length"
                  label="Dígitos del PLU"
                  type="number"
                  min={4}
                  max={6}
                  value={scale.pluLength}
                  onChange={(e) => setScale((s) => ({ ...s, pluLength: Number(e.target.value) || 0 }))}
                />
                <Input
                  data-testid="scale-value-length"
                  label="Dígitos del valor"
                  type="number"
                  min={4}
                  max={6}
                  value={scale.valueLength}
                  onChange={(e) => setScale((s) => ({ ...s, valueLength: Number(e.target.value) || 0 }))}
                />
              </div>
              <p className="text-xs text-slate-500">
                El PLU se busca en el código de barras o el código del producto (sin importar los ceros a la izquierda).
                El peso se convierte a kilogramos (a gramos o libras si el producto se vende así).
              </p>
              {scaleError && <p data-testid="scale-error" className="text-xs text-error">{scaleError}</p>}
              {example && (
                <p className="text-xs text-slate-500" data-testid="scale-example">
                  Ejemplo: <span className="font-mono">{example}</span> = PLU 123,{' '}
                  {scale.valueKind === 'weight' ? '1.250 kg' : '$15.99'}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
