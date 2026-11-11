import React from 'react';
import { Button } from './Button';
import { FileText, Users, Package, TrendingUp, CreditCard, File, ShoppingCart } from 'lucide-react';

// Contextual tips for different empty states
const getContextualTip = (title: string): string => {
  const tips: Record<string, string> = {
    'No hay facturas': '💡 Tip: Use "Nueva Factura" para crear su primer documento o ver las instrucciones en este panel.',
    'No hay clientes': '💡 Tip: Agregue clientes para poder emitir facturas. Puede crear clientes individuales o empresariales.',
    'No hay productos': '💡 Tip: Agregue productos o servicios para agregarlos a sus facturas.',
    'No hay compras': '💡 Tip: Conecte su cuenta de Gmail o configure IMAP para importar compras automáticamente.',
  };
  return tips[title] || '';
};

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  message?: string;
  tip?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  iconComponent?: React.ComponentType<{ className?: string }>;
}

export function EmptyState({ icon, title, message, action, tip, iconComponent }: EmptyStateProps) {
  // Auto-generate tip if not provided
  const displayTip = tip || getContextualTip(title);

  // Select icon component based on title
  const IconComponent = iconComponent ||
    (title === 'No hay facturas' ? FileText :
     title === 'No hay clientes' ? Users :
     title === 'No hay productos' ? Package :
     title === 'No hay compras' ? ShoppingCart :
     TrendingUp);

  // Color variation based on context
  const titleColor = title === 'No hay facturas' ? 'text-brand-700' : 'text-brand-700';
  const messageColor = 'text-brand-500';
  const tipColor = 'text-brand-400';

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 text-center">
      {/* Context-aware icon */}
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-brand-100 text-brand-400">
        <IconComponent size={32} className={title === 'No hay compras' ? 'text-blue-400' : ''} />
      </div>

      <div className="flex flex-col gap-1 max-w-xs">
        <p className={`text-base font-semibold ${titleColor}`}>{title}</p>
        {message && <p className={`${messageColor}`}>{message}</p>}
        {/* Contextual hints */}
        {displayTip && (
          <p className={`${tipColor} mt-2`}>
            {displayTip}
          </p>
        )}
        {/* Additional status-specific tips */}
        {title === 'No hay facturas' && (
          <p className="text-xs text-brand-400 mt-1">
            Las facturas creadas se sincronizan automáticamente con el portal tributario.
          </p>
        )}
        {title === 'No hay clientes' && (
          <p className="text-xs text-brand-400 mt-1">
            Puede crear clientes desde este panel o durante la creación de facturas.
          </p>
        )}
        {title === 'No hay productos' && (
          <p className="text-xs text-brand-400 mt-1">
            Los productos se cargan desde los catálogos DTE o pueden agregarse manualmente.
          </p>
        )}
        {title === 'No hay compras' && (
          <p className="text-xs text-brand-400 mt-1">
            Conecte Gmail para importar facturas automáticamente desde su bandeja de entrada.
          </p>
        )}
      </div>
      {action && (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export default EmptyState;
