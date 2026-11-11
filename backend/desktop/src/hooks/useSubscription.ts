/**
 * useSubscription — Hook para acceder al estado de suscripción
 *
 * Lee el tier activo desde el subscriptionSlice y expone utilidades
 * de verificación de características por nivel.
 */

import { useCallback } from 'react';
import { useAppSelector } from '@/store';
import {
  selectCurrentTier,
  selectIsLite,
  selectIsAdFree,
  selectIsPro,
  selectActiveSubscription,
  selectSubscriptionLoading,
} from '@/store';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import {
  canExport,
  canBatchExportPDF,
  canUploadToDrive,
  canUseAzureSync,
  canSendEmail,
  canExportExcel,
  canCreateCompany,
  getMaxCompanies,
} from '@/services/subscription/FeatureGate';

export type SubscriptionFeature =
  | 'export'
  | 'batchPDF'
  | 'googleDrive'
  | 'azureSync'
  | 'email'
  | 'excel';

export interface UseSubscriptionReturn {
  /** Tier activo del usuario */
  tier: SubscriptionTier;
  /** true si el usuario está en el tier Lite (gratuito) */
  isLite: boolean;
  /** true si el usuario está en el tier AdFree */
  isAdFree: boolean;
  /** true si el usuario está en el tier Pro */
  isPro: boolean;
  /** Suscripción activa (puede ser null en Lite) */
  activeSubscription: ReturnType<typeof selectActiveSubscription>;
  /** true mientras se inicializa o consulta el estado */
  loading: boolean;
  /**
   * Comprueba si el usuario puede acceder a una característica específica.
   * @param feature - Nombre de la característica a verificar
   * @param companyCount - Cantidad actual de empresas (solo para 'maxCompanies')
   */
  canAccessFeature: (feature: SubscriptionFeature, companyCount?: number) => boolean;
  /**
   * Devuelve true si el usuario debería ver un modal de actualización
   * al intentar acceder a una característica Pro.
   */
  showUpgradePrompt: (feature: SubscriptionFeature) => boolean;
  /** Número máximo de empresas permitidas para el tier actual */
  maxCompanies: number;
}

export function useSubscription(): UseSubscriptionReturn {
  const tier = useAppSelector(selectCurrentTier);
  const isLite = useAppSelector(selectIsLite);
  const isAdFree = useAppSelector(selectIsAdFree);
  const isPro = useAppSelector(selectIsPro);
  const activeSubscription = useAppSelector(selectActiveSubscription);
  const loading = useAppSelector(selectSubscriptionLoading);

  const canAccessFeature = useCallback(
    (feature: SubscriptionFeature, companyCount = 0): boolean => {
      switch (feature) {
        case 'export':      return canExport(tier);
        case 'batchPDF':    return canBatchExportPDF(tier);
        case 'googleDrive': return canUploadToDrive(tier);
        case 'azureSync':   return canUseAzureSync(tier);
        case 'email':       return canSendEmail(tier);
        case 'excel':       return canExportExcel(tier);
        default:            return false;
      }
    },
    [tier],
  );

  const showUpgradePrompt = useCallback(
    (feature: SubscriptionFeature): boolean => {
      return !canAccessFeature(feature);
    },
    [canAccessFeature],
  );

  return {
    tier,
    isLite,
    isAdFree,
    isPro,
    activeSubscription,
    loading,
    canAccessFeature,
    showUpgradePrompt,
    maxCompanies: getMaxCompanies(tier),
  };
}
