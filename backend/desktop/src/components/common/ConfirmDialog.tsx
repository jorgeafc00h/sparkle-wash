import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { AlertTriangle, FileX } from 'lucide-react';

// Contextual warning message based on action
const getWarningMessage = (title: string): string | null => {
  const warnings: Record<string, string> = {
    'Eliminar DTE': '⚠️ Esta acción es irreversible. El DTE será eliminado localmente y no podrá recuperarse.',
    'Eliminar evento': '⚠️ Esta acción es irreversible. El evento será eliminado localmente y no podrá recuperarse.',
    'Eliminar producto': '⚠️ El producto será eliminado de su catálogo. Las facturas existentes no se afectarán.',
    'Eliminar cliente': '⚠️ El cliente será eliminado. Las facturas relacionadas no se borrarán pero perderán su asociación.',
    'Evento de invalidación': '⚠️ Registrar este evento dejará constancia ante Hacienda del motivo de invalidación.',
  };
  return warnings[title] || null;
};

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  children?: React.ReactNode;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default',
  children,
}: ConfirmDialogProps) {
  function handleConfirm() {
    onConfirm();
    onClose();
  }

  // Get contextual warning
  const warningMessage = getWarningMessage(title);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Main message */}
        {message && <p className="text-sm text-brand-600">{message}</p>}

        {/* Contextual warning */}
        {warningMessage && (
          <div className="p-3 bg-amber-50 rounded border border-amber-200">
            <p className="text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{warningMessage}</span>
            </p>
          </div>
        )}

        {/* Custom children content */}
        {children}
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
