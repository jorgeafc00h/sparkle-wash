import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastOptions {
  errorContext?: string;
  warningContext?: string;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => void;
  success: (message: string) => void;
  error: (message: string, options?: ToastOptions) => void;
  warning: (message: string, options?: ToastOptions) => void;
  info: (message: string) => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Config ──────────────────────────────────────────────────────────────────

const typeConfig: Record<
  ToastType,
  { icon: React.ReactNode; classes: string }
> = {
  success: {
    icon: <CheckCircle size={18} className="shrink-0 text-green-500" />,
    classes: 'bg-white border-green-400',
  },
  error: {
    icon: <XCircle size={18} className="shrink-0 text-red-500" />,
    classes: 'bg-white border-red-400',
  },
  warning: {
    icon: <AlertTriangle size={18} className="shrink-0 text-amber-500" />,
    classes: 'bg-white border-amber-400',
  },
  info: {
    icon: <Info size={18} className="shrink-0 text-blue-500" />,
    classes: 'bg-white border-blue-400',
  },
};

const DISMISS_MS: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  warning: 7000,
  error: 9000,
};

// ─── Individual Toast ─────────────────────────────────────────────────────────

interface ToastItemExtended extends ToastItem {
  errorContext?: string;
  warningContext?: string;
}

function ToastCard({
  toast,
  onClose,
}: {
  toast: ToastItemExtended;
  onClose: (id: string) => void;
}) {
  const { icon, classes } = typeConfig[toast.type];

  useEffect(() => {
    const id = setTimeout(() => onClose(toast.id), DISMISS_MS[toast.type]);
    return () => clearTimeout(id);
  }, [toast.id, toast.type, onClose]);

  const isError = toast.type === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={[
        'flex items-start gap-3 w-80 rounded-lg border-l-4 shadow-lg px-4 py-3',
        classes,
      ].join(' ')}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <p className="flex-1 text-sm text-brand-800">{toast.message}</p>
        {toast.type === 'error' && toast.errorContext && (
          <div className="text-xs text-brand-500 mt-1">
            {toast.errorContext}
          </div>
        )}
        {toast.type === 'warning' && toast.warningContext && (
          <div className="text-xs text-brand-600 mt-1">
            {toast.warningContext}
          </div>
        )}
      </div>
      <button
        onClick={() => onClose(toast.id)}
        className="text-brand-400 hover:text-brand-600 transition-colors"
        aria-label="Cerrar notificación"
      >
        <X size={16} />
      </button>
    </div>
  );
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', options?: { errorContext?: string; warningContext?: string }) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { id, type, message, ...options } as ToastItemExtended]);
    },
    []
  );

  const ctx: ToastContextValue = {
    showToast: (msg, type = 'info', options) => showToast(msg, type, options),
    success: (msg) => showToast(msg, 'success'),
    error: (msg, options) => showToast(msg, 'error', options),
    warning: (msg, options) => showToast(msg, 'warning', options),
    info: (msg) => showToast(msg, 'info'),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          className="fixed top-4 right-4 z-[100] flex flex-col gap-2"
        >
          {toasts.map((t) => (
            <ToastCard key={t.id} toast={t} onClose={dismiss} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

export default ToastProvider;
