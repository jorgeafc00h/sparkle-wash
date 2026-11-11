// Device Sync v2 React integration — Desktop (design D3/D9, Phase 1/2).
//
// useSyncV2Lifecycle — mounted ONCE (App shell). Sessions are BURSTS (see
// syncBurstController): a WebSocket opens only for the manual "Sincronizar ahora"
// button, and — while "Automático" is armed (enabled + more than one registered
// device) — for debounced outbox bursts and one pull shortly after sign-in with a
// claimed company. A settled session closes after ~90 s of outbox silence, so the
// relay replica can scale back to zero. Free / paid-without-sync never open
// anything (canUseDeviceSync + relay-confirmed entitlement), and logging out closes
// the session.
//
// The lifecycle also drives the Phase 1 company claim (POST /api/auth/companies/claim):
// signed-in users get every production company claimed automatically (sign-in and
// production activation are just "an unclaimed production company exists"), while the
// Sincronización page offers the explicit "Vincular empresa" action.
//
// useDeviceSyncPanel — state + actions for the Sincronización page.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../store';
import { selectCurrentTier } from '../store/selectors/subscriptionSelectors';
import {
  clearConflicts,
  claimSyncCompany,
  createCompanySyncState,
  isCompanyClaimed,
  setAutoSync,
  setRegisteredDevices,
  setSyncDeviceId,
  setSyncStatus,
} from '../store/slices/syncV2Slice';
import { canUseDeviceSync } from '../services/subscription/FeatureGate';
import { companySyncKey, isProductionSyncCompany } from '../services/sync/protocol';
import { getDeviceId } from '../services/sync/deviceId';
import {
  fetchRegisteredSyncDevicesForEnv,
  getSyncBurstController,
  getSyncV2Engine,
} from '../services/sync/syncV2Environment';

const toMillis = (iso: string | undefined): number => {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
};

export function useSyncV2Lifecycle(): void {
  const dispatch = useAppDispatch();
  const tier = useAppSelector(selectCurrentTier);
  const entitled = useAppSelector((state) => state.syncV2?.entitled ?? false);
  // Select the derived key (a string), never the company object: this hook lives in the
  // App shell, and subscribing to `currentCompany` re-rendered the whole router tree on
  // every company update (e.g. each sequence bump during the production-access batch).
  const co = useAppSelector((state) => companySyncKey(state.companies.currentCompany));
  const companies = useAppSelector((state) => state.companies.companies);
  const claims = useAppSelector((state) => state.syncV2?.claims ?? {});
  const claiming = useAppSelector((state) => state.syncV2?.claiming ?? {});
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const signedIn = useAppSelector((state) => state.auth.isAuthenticated || state.auth.isGuestMode);
  const autoSync = useAppSelector((state) => state.syncV2?.autoSync ?? false);
  const allowed = canUseDeviceSync(tier) || entitled;
  // The current company is claimed — string key, so the App shell only re-renders when
  // the answer actually changes.
  const claimedCo = useAppSelector((state) =>
    isCompanyClaimed(state.syncV2?.claims ?? {}, state.companies.currentCompany)
      ? companySyncKey(state.companies.currentCompany)
      : null,
  );

  // Resolve the device identity early so captured changes carry the real id.
  useEffect(() => {
    getDeviceId()
      .then((id) => dispatch(setSyncDeviceId(id)))
      .catch(() => undefined);
  }, [dispatch]);

  // Burst policy: subscribes to outbox changes once; sessions themselves are opened by
  // the user actions below and close on the linger.
  useEffect(() => {
    const controller = getSyncBurstController();
    controller.start();
    return () => controller.stop();
  }, []);

  // One background pull per app run, shortly after the app is signed in with a
  // claimed company (the controller re-checks arming/eligibility when it fires).
  useEffect(() => {
    if (isAuthenticated && claimedCo) getSyncBurstController().scheduleStartupPull();
  }, [isAuthenticated, claimedCo]);

  // "Automático" is armed from the relay's registered-device count, which is
  // runtime-only state: after a restart nothing had fetched it yet, so a persisted
  // autoSync opt-in never armed (no debounced bursts, no startup pull) until the user
  // happened to open the Sincronización page. Re-arm by fetching the list at startup.
  useEffect(() => {
    if (!isAuthenticated || !allowed || !co || !autoSync) return;
    let cancelled = false;
    void fetchRegisteredSyncDevicesForEnv(co).then(result => {
      // "unavailable" (endpoint missing/refused) ⇒ empty list ⇒ single-device assumption.
      if (!cancelled) {
        dispatch(setRegisteredDevices({ co, devices: result.kind === 'devices' ? result.devices : [] }));
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isAuthenticated, allowed, co, autoSync, dispatch]);

  // Company switched while a session is open: move the session to the new company
  // through the burst controller so the linger restarts for it.
  useEffect(() => {
    const engine = getSyncV2Engine();
    if (co && engine.isLive() && engine.activeCompanyKey() !== co) void getSyncBurstController().syncNow();
  }, [co]);

  // Entitlement lost (downgrade/expiry) or signed out: close everything.
  useEffect(() => {
    if (allowed && signedIn) return;
    const engine = getSyncV2Engine();
    if (engine.isLive()) void engine.stopSession();
    if (!allowed) dispatch(setSyncStatus({ status: 'locked' }));
  }, [allowed, signedIn, dispatch]);

  // Window closing: one opportunistic REST flush of anything still queued.
  useEffect(() => {
    const onBeforeUnload = () => {
      const engine = getSyncV2Engine();
      if (engine.isLive()) void engine.stopSession({ flushViaRest: true });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // ── Phase 1: automatic company claim ──
  // Any production company that was never attempted gets claimed on sign-in and on
  // production activation (both are "an unclaimed production company exists while
  // signed in"). Attempts that found no stored Hacienda credentials — or hit a
  // transient failure — leave no record, so saving the credentials (which bumps
  // updatedAt) or the next sign-in retries.
  const attemptRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!isAuthenticated) return;
    for (const company of companies) {
      if (!isProductionSyncCompany(company) || !company.nit) continue;
      const key = companySyncKey(company);
      if (!key || claims[key] || claiming[key]) continue;
      // Skip re-attempts unless the company changed since the last one (e.g. the
      // user just saved Hacienda credentials for it).
      if ((attemptRef.current[key] ?? 0) >= toMillis(company.updatedAt)) continue;
      attemptRef.current[key] = Date.now();
      void dispatch(claimSyncCompany(company));
    }
  }, [isAuthenticated, companies, claims, claiming, dispatch]);
}

export function useDeviceSyncPanel() {
  const dispatch = useAppDispatch();
  const tier = useAppSelector(selectCurrentTier);
  const syncV2 = useAppSelector((state) => state.syncV2);
  const currentCompany = useAppSelector((state) => state.companies.currentCompany);
  const co = companySyncKey(currentCompany);
  const allowed = canUseDeviceSync(tier) || !!syncV2?.entitled;

  const company = useMemo(
    () => (co && syncV2?.companies?.[co]) || createCompanySyncState(),
    [co, syncV2?.companies],
  );
  const online = useMemo(() => (co ? syncV2?.onlineByCo?.[co] ?? [] : []), [co, syncV2?.onlineByCo]);
  const outboxCount = Object.keys(company.outbox).length;

  const claimState = co ? syncV2?.claims?.[co] : undefined;
  const claiming = co ? !!syncV2?.claiming?.[co] : false;
  const claimed = isCompanyClaimed(syncV2?.claims ?? {}, currentCompany);
  const registeredDevices = co ? syncV2?.registeredDevices?.[co] ?? [] : [];
  const autoAvailable = registeredDevices.length > 1;

  // The registered-device list gates "Automático" — refresh it when the panel opens
  // for a company and after each settled sync (the relay is awake then anyway).
  const refreshDevices = useCallback(async (companyKey: string) => {
    const result = await fetchRegisteredSyncDevicesForEnv(companyKey);
    // "unavailable" (endpoint missing/refused) ⇒ empty list ⇒ single-device assumption.
    dispatch(setRegisteredDevices({
      co: companyKey,
      devices: result.kind === 'devices' ? result.devices : [],
    }));
  }, [dispatch]);

  useEffect(() => {
    if (!allowed || !co) return;
    void refreshDevices(co);
  }, [allowed, co, refreshDevices]);

  const syncNow = useCallback(async () => {
    const outcome = await getSyncBurstController().syncNow();
    if (outcome.ok && co) void refreshDevices(co);
    return outcome;
  }, [co, refreshDevices]);

  const stop = useCallback(() => getSyncV2Engine().stopSession({ flushViaRest: true }), []);
  const toggleAutoSync = useCallback((value: boolean) => dispatch(setAutoSync(value)), [dispatch]);
  const claimCompany = useCallback(() => {
    if (currentCompany) void dispatch(claimSyncCompany(currentCompany));
  }, [currentCompany, dispatch]);
  const dismissConflicts = useCallback(() => {
    if (co) dispatch(clearConflicts({ co }));
  }, [co, dispatch]);

  return {
    allowed,
    tier,
    co,
    companyName: currentCompany?.nombreComercial || currentCompany?.nombre || '',
    deviceId: syncV2?.deviceId ?? null,
    status: syncV2?.status ?? 'idle',
    lastError: syncV2?.lastError ?? null,
    autoSync: syncV2?.autoSync ?? false,
    company,
    online,
    outboxCount,
    syncNow,
    stop,
    toggleAutoSync,
    dismissConflicts,
    // Phase 1 — company claim ("empresa vinculada")
    isProductionCompany: isProductionSyncCompany(currentCompany),
    claimed,
    claiming,
    claimError: claimState?.status === 'failed' ? claimState.error ?? null : null,
    claimCompany,
    // Phase 2 — registered devices + the "Automático" gate
    registeredDevices,
    autoAvailable,
  };
}

export type DeviceSyncPanel = ReturnType<typeof useDeviceSyncPanel>;
