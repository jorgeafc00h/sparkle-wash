import React, { useState } from 'react';
import { Lock, ArrowUpRight } from 'lucide-react';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { SubscriptionModal } from './SubscriptionModal';

export interface UpgradePromptProps {
  featureName: string;
  requiredTier: SubscriptionTier;
  className?: string;
}

const tierLabel: Record<SubscriptionTier, string> = {
  [SubscriptionTier.Lite]: 'Free',
  [SubscriptionTier.AdFree]: 'Pro',
  [SubscriptionTier.Pro]: 'Business',
  [SubscriptionTier.ProSync]: 'Pro+Sync',
  [SubscriptionTier.Enterprise]: 'Enterprise',
};

const tierColorClass: Record<SubscriptionTier, string> = {
  [SubscriptionTier.Lite]: 'border-brand-200 bg-brand-50',
  [SubscriptionTier.AdFree]: 'border-blue-200 bg-blue-50',
  [SubscriptionTier.Pro]: 'border-purple-200 bg-purple-50',
  [SubscriptionTier.ProSync]: 'border-purple-200 bg-purple-50',
  [SubscriptionTier.Enterprise]: 'border-purple-200 bg-purple-50',
};

const tierIconClass: Record<SubscriptionTier, string> = {
  [SubscriptionTier.Lite]: 'text-brand-500',
  [SubscriptionTier.AdFree]: 'text-blue-500',
  [SubscriptionTier.Pro]: 'text-purple-500',
  [SubscriptionTier.ProSync]: 'text-purple-500',
  [SubscriptionTier.Enterprise]: 'text-purple-500',
};

const tierBadgeClass: Record<SubscriptionTier, string> = {
  [SubscriptionTier.Lite]: 'bg-brand-100 text-brand-700',
  [SubscriptionTier.AdFree]: 'bg-blue-100 text-blue-700',
  [SubscriptionTier.Pro]: 'bg-purple-100 text-purple-700',
  [SubscriptionTier.ProSync]: 'bg-purple-100 text-purple-700',
  [SubscriptionTier.Enterprise]: 'bg-purple-100 text-purple-700',
};

export function UpgradePrompt({
  featureName,
  requiredTier,
  className = '',
}: UpgradePromptProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div
        className={[
          'flex items-center gap-3 rounded-xl border-2 px-4 py-3',
          tierColorClass[requiredTier],
          className,
        ].join(' ')}
      >
        <div className="shrink-0">
          <Lock size={18} className={tierIconClass[requiredTier]} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-brand-800 truncate">{featureName}</p>
          <p className="text-xs text-brand-500 mt-0.5">
            Disponible en el plan{' '}
            <span className={['inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold', tierBadgeClass[requiredTier]].join(' ')}>
              {tierLabel[requiredTier]}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={[
            'shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors',
            requiredTier === SubscriptionTier.Pro
              ? 'bg-purple-600 text-white hover:bg-purple-700'
              : 'bg-accent-600 text-white hover:bg-accent-700',
          ].join(' ')}
        >
          Mejorar Plan
          <ArrowUpRight size={13} />
        </button>
      </div>

      <SubscriptionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        requiredTier={requiredTier}
        featureName={featureName}
      />
    </>
  );
}

export default UpgradePrompt;
