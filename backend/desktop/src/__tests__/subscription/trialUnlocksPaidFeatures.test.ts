import * as Gate from '../../services/subscription/FeatureGate';
import { SubscriptionTier } from '../../services/subscription/SubscriptionTypes';
import { TRIAL_INCLUDES } from '../../services/subscription/SyncTrialService';

// The sync trial grants pro_sync: every paid gate must be open while it runs.
describe('free trial (pro_sync) unlocks every paid feature', () => {
  const t = SubscriptionTier.ProSync;
  it.each([
    ['Libros IVA', Gate.canUseLibrosIVA],
    ['JSON export', Gate.canExport],
    ['batch PDF', Gate.canBatchExportPDF],
    ['Drive', Gate.canUploadToDrive],
    ['email', Gate.canSendEmail],
    ['POS consolidation', Gate.canUsePosConsolidation],
    ['Azure sync', Gate.canUseAzureSync],
    ['device sync', Gate.canUseDeviceSync],
  ] as const)('%s', (_n, gate) => {
    expect(gate(t)).toBe(true);
  });
  it('free tier stays locked', () => {
    expect(Gate.canUseLibrosIVA(SubscriptionTier.Lite)).toBe(false);
    expect(Gate.canUsePosConsolidation(SubscriptionTier.Lite)).toBe(false);
  });
  it('offer copy lists Libros IVA', () => {
    expect(TRIAL_INCLUDES.join(' ')).toMatch(/Libros de IVA/);
  });
});
