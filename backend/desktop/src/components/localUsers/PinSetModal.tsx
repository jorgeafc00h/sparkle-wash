import { useEffect, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { isValidPin } from '@/services/localUsers/pinHash';

interface PinSetModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onSubmit: (pin: string) => void;
}

/** New PIN + confirmation (activate user control, change/reset a PIN). */
export function PinSetModal({ isOpen, onClose, title, description, confirmLabel = 'Guardar', onSubmit }: PinSetModalProps) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setConfirm('');
      setSubmitted(false);
    }
  }, [isOpen]);

  const pinError = !isValidPin(pin) ? 'El PIN debe tener de 4 a 8 dígitos' : undefined;
  const confirmError = !pinError && pin !== confirm ? 'Los PIN no coinciden' : undefined;

  function handleSubmit() {
    setSubmitted(true);
    if (pinError || confirmError) return;
    onSubmit(pin);
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} data-testid="pin-set-cancel">
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSubmit} data-testid="pin-set-save">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        {description && <p className="text-sm text-brand-600">{description}</p>}
        <Input
          id="pin-set-pin"
          label="Nuevo PIN"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={8}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          error={submitted ? pinError : undefined}
          helperText="4 a 8 dígitos"
          data-testid="pin-set-pin"
        />
        <Input
          id="pin-set-confirm"
          label="Confirmar PIN"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
          error={submitted ? confirmError : undefined}
          data-testid="pin-set-confirm"
        />
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

export default PinSetModal;
