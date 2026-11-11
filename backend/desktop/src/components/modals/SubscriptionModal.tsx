import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Star, Zap, Shield } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { FreeTrialOffer } from './FreeTrialOffer';
import { useAppSelector } from '@/store';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';

export interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  requiredTier?: SubscriptionTier;
  featureName?: string;
}

interface TierConfig {
  tier: SubscriptionTier;
  name: string;
  price: string;
  description: string;
  icon: React.ReactNode;
  features: string[];
  accentClass: string;
  borderClass: string;
  iconBgClass: string;
}

const TIER_CONFIGS: TierConfig[] = [
  {
    tier: SubscriptionTier.Lite,
    name: 'Free',
    price: 'Gratis',
    description: 'Para empezar a facturar',
    icon: <Zap size={20} />,
    features: [
      'Hasta 10 facturas por mes',
      '1 empresa',
      'Todos los tipos de DTE',
      'Firma local',
      'Marca de agua en PDFs',
    ],
    accentClass: 'text-brand-600',
    borderClass: 'border-brand-200',
    iconBgClass: 'bg-brand-100 text-brand-600',
  },
  {
    tier: SubscriptionTier.AdFree,
    name: 'Pro',
    price: '$7.00/mes',
    description: 'Para profesionales y pequeños negocios',
    icon: <Star size={20} />,
    features: [
      'Facturas ilimitadas',
      'Hasta 2 empresas',
      'Envío de DTE por correo',
      'Libros de IVA (F-07)',
      'Respaldo en Google Drive',
      'Sincronización en la nube',
      'Sin anuncios',
    ],
    accentClass: 'text-blue-600',
    borderClass: 'border-blue-200',
    iconBgClass: 'bg-blue-100 text-blue-600',
  },
  {
    tier: SubscriptionTier.Pro,
    name: 'Business',
    price: '$14.00/mes',
    description: 'Para empresas y contadores',
    icon: <Shield size={20} />,
    features: [
      'Todo lo de Pro',
      'Empresas ilimitadas',
      'Soporte prioritario',
    ],
    accentClass: 'text-purple-600',
    borderClass: 'border-purple-200',
    iconBgClass: 'bg-purple-100 text-purple-600',
  },
];

export function SubscriptionModal({
  isOpen,
  onClose,
  requiredTier,
  featureName,
}: SubscriptionModalProps) {
  const currentTier = useAppSelector(selectCurrentTier);
  const navigate = useNavigate();

  function handleUpgrade() {
    onClose();
    navigate('/settings/promo');
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Planes de suscripción"
      size="lg"
    >
      <div className="flex flex-col gap-5 py-1">
        {featureName && requiredTier && (
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 rounded-lg border border-amber-200">
            <Zap size={16} className="text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800">
              <strong>{featureName}</strong> requiere el plan{' '}
              <strong>
                {TIER_CONFIGS.find((t) => t.tier === requiredTier)?.name ?? requiredTier}
              </strong>
              .
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          {TIER_CONFIGS.map((config) => {
            const isCurrent = currentTier === config.tier;
            const isRequired = requiredTier === config.tier;

            return (
              <div
                key={config.tier}
                className={[
                  'flex flex-col rounded-xl border-2 p-4 transition-shadow',
                  isRequired
                    ? 'border-accent-400 shadow-md ring-2 ring-accent-200'
                    : isCurrent
                    ? config.borderClass
                    : 'border-brand-100',
                ].join(' ')}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className={['w-9 h-9 rounded-lg flex items-center justify-center', config.iconBgClass].join(' ')}>
                    {config.icon}
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    {isCurrent && (
                      <Badge variant="success" size="sm">
                        Actual
                      </Badge>
                    )}
                    {isRequired && !isCurrent && (
                      <Badge variant="warning" size="sm">
                        Requerido
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Name & price */}
                <h3 className={['text-base font-bold', config.accentClass].join(' ')}>
                  {config.name}
                </h3>
                <p className="text-lg font-semibold text-brand-900 mt-0.5">{config.price}</p>
                <p className="text-xs text-brand-500 mt-0.5 mb-3">{config.description}</p>

                {/* Features */}
                <ul className="flex flex-col gap-1.5 flex-1">
                  {config.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-xs text-brand-700">
                      <Check size={13} className="text-green-500 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className="mt-4">
                  {isCurrent ? (
                    <div className="w-full text-center text-xs text-brand-400 py-1.5">
                      Plan activo
                    </div>
                  ) : config.tier !== SubscriptionTier.Lite ? (
                    <button
                      onClick={handleUpgrade}
                      className={[
                        'w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isRequired
                          ? 'bg-accent-600 text-white hover:bg-accent-700'
                          : 'bg-brand-100 text-brand-700 hover:bg-brand-200',
                      ].join(' ')}
                    >
                      Mejorar Plan
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <FreeTrialOffer className="py-1" />

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default SubscriptionModal;
