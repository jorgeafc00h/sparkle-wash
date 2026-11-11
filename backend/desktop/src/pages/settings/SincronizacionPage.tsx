// Configuración → Sincronización (Device Sync v2). Pro+Sync/Enterprise see their devices,
// the pending outbox, conflicts and "Pendiente de verificar"; other tiers see the locked
// state with the upgrade path (and generate zero sync traffic). Sync works in BURSTS:
// "Sincronizar ahora" opens a session that closes itself after ~90 s without activity,
// so the relay can scale to zero. "Automático" (background bursts) is offered only when
// the relay reports more than one device for the company. The company must be VINCULADA
// (claimed with its Hacienda credentials) for the relay to authorize it. testIDs mirror
// the RN panel.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Link2, Lock, Monitor, RefreshCw, Smartphone } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { useDeviceSyncPanel } from '@/hooks/useSyncV2';
import { useAppDispatch, useAppSelector } from '@/store';
import { startSyncTrial } from '@/store/slices/subscriptionSlice';
import { resolveSyncTrialView } from '@/services/subscription/SyncTrialService';
import type { DeviceManifest, SyncEntityType } from '@/services/sync/protocol';
import type { RegisteredSyncDevice } from '@/services/sync/syncDevicesService';
import type { SyncConflict } from '@/services/sync/mergeEngine';
import type { SyncV2Status } from '@/store/slices/syncV2Slice';

const STATUS_LABELS: Record<SyncV2Status, string> = {
  idle: 'Sin sesión activa',
  locked: 'Bloqueado',
  connecting: 'Conectando…',
  syncing: 'Sincronizando…',
  live: 'En línea',
  offline: 'Sin conexión',
  error: 'Error',
};

const STATUS_VARIANT: Record<SyncV2Status, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  idle: 'neutral',
  locked: 'neutral',
  connecting: 'info',
  syncing: 'info',
  live: 'success',
  offline: 'warning',
  error: 'error',
};

const ENTITY_LABELS: Record<SyncEntityType, string> = {
  invoice: 'Facturas',
  customer: 'Clientes',
  product: 'Productos',
  purchase: 'Compras',
  company: 'Empresa',
  ticket: 'Tickets POS',
};

const PLATFORM_LABELS: Record<DeviceManifest['platform'], string> = {
  android: 'Android',
  desktop: 'Escritorio',
  ios: 'iPhone',
};

const FIELD_LABELS: Record<string, string> = {
  generationCode: 'Código de generación',
  controlNumber: 'Número de control',
  receptionSeal: 'Sello de recepción',
  fechaTransmision: 'Fecha de transmisión',
  items: 'Detalle del documento',
};

export const formatSyncTime = (iso: string | null | undefined): string => {
  if (!iso) return 'Nunca';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Nunca';
  return date.toLocaleString('es-SV', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** Relative "hace …" for a device's last contact — never in the future. */
export const formatRelativeSeen = (iso: string | null | undefined, now: Date = new Date()): string => {
  if (!iso) return 'Sin registro';
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return 'Sin registro';
  const seconds = Math.max(0, Math.round((now.getTime() - at) / 1000));
  if (seconds < 60) return 'Hace un momento';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `Hace ${days} ${days === 1 ? 'día' : 'días'}`;
};

export const describeCounts = (counts: DeviceManifest['counts'] | undefined): string =>
  (['invoice', 'customer', 'product', 'purchase'] as SyncEntityType[])
    .map((type) => `${ENTITY_LABELS[type]} ${counts?.[type] ?? 0}`)
    .join(' · ');

const conflictLabel = (conflict: SyncConflict): string =>
  `${ENTITY_LABELS[conflict.t]} ${conflict.id.slice(0, 8)} — ${FIELD_LABELS[conflict.field] ?? conflict.field}`;

/** One row per device: the relay's registered list enriched with session manifests. */
interface DeviceRow {
  deviceId: string;
  manifest: DeviceManifest | null;
  registered: RegisteredSyncDevice | null;
}

const mergeDeviceRows = (
  peers: DeviceManifest[],
  registered: RegisteredSyncDevice[],
  selfDeviceId: string | null,
): DeviceRow[] => {
  const byId = new Map<string, DeviceRow>();
  for (const manifest of peers) {
    if (manifest.deviceId === selfDeviceId) continue;
    byId.set(manifest.deviceId, { deviceId: manifest.deviceId, manifest, registered: null });
  }
  for (const device of registered) {
    if (device.deviceId === selfDeviceId) continue;
    const existing = byId.get(device.deviceId);
    if (existing) existing.registered = device;
    else byId.set(device.deviceId, { deviceId: device.deviceId, manifest: null, registered: device });
  }
  return Array.from(byId.values()).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
};

export default function SincronizacionPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const panel = useDeviceSyncPanel();
  const signedIn = useAppSelector((state) => state.auth.isAuthenticated);
  const trialStarting = useAppSelector((state) => state.subscription.trialStarting);
  const syncTrialUsed = useAppSelector((state) => state.subscription.syncTrialUsed);
  const trialUntil = useAppSelector((state) => state.subscription.accountEntitlement?.trialUntil ?? null);
  const trial = resolveSyncTrialView({ tier: panel.tier, trialUntil, syncTrialUsed });
  // Failure feedback for the trial button (RN parity: sync-trial-error). Kept in
  // component state — the slice's shared `error` also carries unrelated
  // subscription errors that must not leak into this panel.
  const [trialError, setTrialError] = useState<string | null>(null);

  function handleStartTrial() {
    // The trial belongs to the signed-in account — unsigned users land on the
    // same sign-in path as the upgrade button.
    if (!signedIn) {
      navigate('/settings/account');
      return;
    }
    setTrialError(null);
    dispatch(startSyncTrial())
      .unwrap()
      .catch((err: unknown) => {
        // rejectWithValue payload — the Spanish message from the thunk.
        setTrialError(
          typeof err === 'string' ? err : 'No se pudo iniciar la prueba gratis. Inténtalo de nuevo más tarde.',
        );
      });
  }

  if (!panel.allowed) {
    return (
      <div className="space-y-6" data-testid="sync-v2-screen">
        <PageHeader title="Sincronización" subtitle="Tus dispositivos al día" onBack={() => navigate('/settings')} />
        <Card data-testid="sync-v2-locked" className="flex flex-col items-center text-center gap-4 py-10">
          <div className="w-14 h-14 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center">
            <Lock size={28} />
          </div>
          <h2 className="text-lg font-semibold text-brand-800">Sincronización entre dispositivos</h2>
          <p className="text-sm text-brand-500 max-w-md">
            Mantén tus facturas, clientes, productos y compras al día en tu teléfono y en tu computadora.
            Disponible en el plan Pro+Sync.
          </p>
          {trial.showOffer ? (
            <div className="flex flex-col items-center gap-2">
              <Button
                data-testid="sync-trial-start"
                disabled={trialStarting}
                onClick={handleStartTrial}
              >
                {trialStarting ? 'Iniciando…' : 'Iniciar prueba gratis de 2 meses'}
              </Button>
              <p className="text-xs text-brand-400">
                Sin tarjeta, 60 días de Pro+Sync: incluye también Libros IVA, exportación JSON/PDF, Google Drive, correo y consolidación POS.
              </p>
            </div>
          ) : null}
          {trial.showUsed ? (
            <p data-testid="sync-trial-used" className="text-sm text-brand-500">
              Ya usaste tu prueba gratis
            </p>
          ) : null}
          {trialError ? (
            <p data-testid="sync-trial-error" className="text-sm text-red-600 max-w-md">
              {trialError}
            </p>
          ) : null}
          <Button variant={trial.showOffer ? 'ghost' : 'primary'} data-testid="sync-v2-upgrade-button" onClick={() => navigate('/settings/account')}>
            Mejorar a Pro+Sync
          </Button>
        </Card>
      </div>
    );
  }

  const busy = panel.status === 'connecting' || panel.status === 'syncing';
  const isLive = panel.status === 'live';
  const peers = panel.company.devices.filter((device) => device.deviceId !== panel.deviceId);
  const deviceRows = mergeDeviceRows(peers, panel.registeredDevices, panel.deviceId);

  return (
    <div className="space-y-6" data-testid="sync-v2-screen">
      <PageHeader title="Sincronización" subtitle="Tus dispositivos al día" onBack={() => navigate('/settings')} />

      <div data-testid="sync-v2-panel" className="space-y-6">
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <p className="font-semibold text-brand-800">{panel.companyName || 'Empresa'}</p>
            <span data-testid="sync-v2-status">
              <Badge variant={STATUS_VARIANT[panel.status]}>
                <span data-testid="sync-v2-status-text">{STATUS_LABELS[panel.status]}</span>
              </Badge>
            </span>
          </div>
          <p data-testid="sync-v2-last-sync" className="text-sm text-brand-500">
            Última sincronización: {formatSyncTime(panel.company.lastSyncAt)}
          </p>
          {trial.remainingDays !== null ? (
            <p data-testid="sync-trial-remaining" className="text-sm text-accent-700">
              Prueba gratis: {trial.remainingDays} {trial.remainingDays === 1 ? 'día restante' : 'días restantes'}
            </p>
          ) : null}
          <p data-testid="sync-v2-outbox-count" className="text-sm text-brand-500">
            Cambios pendientes de enviar: {panel.outboxCount}
          </p>
          {panel.lastError ? (
            <p data-testid="sync-v2-error" className="text-sm text-red-600">{panel.lastError}</p>
          ) : null}
          <div className="flex items-center gap-3 pt-2">
            <Button data-testid="sync-now-button" disabled={busy} onClick={() => { void panel.syncNow(); }}>
              <RefreshCw size={16} className={busy ? 'animate-spin mr-2 inline' : 'mr-2 inline'} />
              {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
            </Button>
            {isLive ? (
              <Button data-testid="sync-v2-stop" variant="ghost" onClick={() => { void panel.stop(); }}>
                Detener
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-brand-400">
            La sesión se abre al sincronizar y se cierra sola cuando no hay actividad. Tus datos siempre
            quedan guardados en cada dispositivo.
          </p>
        </Card>

        <Card data-testid="sync-claim-card" className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-semibold text-brand-700 flex items-center gap-2">
              <Link2 size={16} /> Empresa y cuenta
            </p>
            {panel.claimed ? (
              <span data-testid="sync-claim-badge">
                <Badge variant="success">Empresa vinculada</Badge>
              </span>
            ) : null}
          </div>
          {panel.claimed ? (
            <p data-testid="sync-claim-hint" className="text-xs text-brand-500">
              Esta empresa está vinculada a tu cuenta: el servicio de sincronización la reconoce en todos tus dispositivos.
            </p>
          ) : panel.isProductionCompany ? (
            <>
              <p className="text-xs text-brand-500">
                Vincula esta empresa con tus credenciales de Hacienda para que el servicio de sincronización
                la reconozca. Se usan las credenciales guardadas en Credenciales API.
              </p>
              {panel.claimError ? (
                <p data-testid="sync-claim-error" className="text-sm text-red-600">{panel.claimError}</p>
              ) : null}
              <div>
                <Button
                  data-testid="sync-claim-button"
                  variant="secondary"
                  disabled={panel.claiming}
                  onClick={panel.claimCompany}
                >
                  {panel.claiming ? 'Vinculando…' : 'Vincular empresa'}
                </Button>
              </div>
            </>
          ) : (
            <p data-testid="sync-claim-hint" className="text-xs text-brand-500">
              Las empresas de prueba se vinculan a través de su empresa de producción (mismo NIT).
            </p>
          )}
        </Card>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-brand-700">Dispositivos</h3>
          <Card data-testid="sync-v2-devices" className="divide-y divide-brand-100">
            {deviceRows.length === 0 ? (
              <p className="text-sm text-brand-500">Aún no hay otros dispositivos registrados para esta empresa.</p>
            ) : (
              deviceRows.map((row) => {
                const online = panel.online.includes(row.deviceId);
                const lastSeen = row.registered?.lastSeen ?? row.manifest?.lastSyncAt ?? null;
                return (
                  <div
                    key={row.deviceId}
                    data-testid={`sync-v2-device-${row.deviceId}`}
                    className="flex items-center gap-4 py-3"
                  >
                    <div className="text-accent-600">
                      {row.manifest?.platform === 'desktop' || row.registered?.platform === 'desktop'
                        ? <Monitor size={22} />
                        : <Smartphone size={22} />}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-brand-800">
                        {row.manifest
                          ? `${PLATFORM_LABELS[row.manifest.platform] ?? row.manifest.platform} · v${row.manifest.appVersion}`
                          : (row.registered?.platform ?? 'Dispositivo')}
                      </p>
                      <p className="text-xs text-brand-400 font-mono" data-testid={`sync-v2-device-id-${row.deviceId}`}>
                        {row.deviceId.slice(0, 12)}
                      </p>
                      {row.manifest ? (
                        <p className="text-xs text-brand-500">{describeCounts(row.manifest.counts)}</p>
                      ) : null}
                      <p className="text-xs text-brand-500">
                        {row.manifest
                          ? `Última sincronización: ${formatSyncTime(row.manifest.lastSyncAt)}`
                          : `Visto: ${formatRelativeSeen(lastSeen)}`}
                      </p>
                    </div>
                    {row.manifest ? (
                      <span
                        data-testid={`sync-v2-device-online-${row.deviceId}`}
                        className={online ? 'text-xs font-semibold text-green-600' : 'text-xs text-brand-400'}
                      >
                        {online ? 'En línea' : 'Desconectado'}
                      </span>
                    ) : (
                      <span className="text-xs text-brand-400">{formatRelativeSeen(lastSeen)}</span>
                    )}
                  </div>
                );
              })
            )}
          </Card>
        </div>

        {panel.company.pendingVerify.length > 0 ? (
          <div data-testid="sync-v2-pending-verify" className="flex flex-wrap gap-2">
            {panel.company.pendingVerify.map((type) => (
              <Badge key={type} variant="warning">{ENTITY_LABELS[type]}: Pendiente de verificar</Badge>
            ))}
          </div>
        ) : null}

        {panel.company.conflicts.length > 0 ? (
          <Card data-testid="sync-v2-conflicts" className="space-y-2 border-red-200">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-red-600 flex items-center gap-2">
                <AlertTriangle size={16} /> Conflictos ({panel.company.conflicts.length})
              </p>
              <Button data-testid="sync-v2-dismiss-conflicts" variant="ghost" onClick={panel.dismissConflicts}>
                Descartar
              </Button>
            </div>
            <p className="text-xs text-brand-500">
              Otro dispositivo reportó un valor distinto para un dato que Hacienda ya registró. Se conservó el valor original.
            </p>
            {panel.company.conflicts.slice(0, 10).map((conflict) => (
              <p key={`${conflict.t}:${conflict.id}:${conflict.field}`} className="text-sm text-brand-700">
                • {conflictLabel(conflict)}
              </p>
            ))}
          </Card>
        ) : null}

        {panel.company.rejected.length > 0 ? (
          <Card data-testid="sync-v2-rejected" className="space-y-1">
            <p className="font-semibold text-brand-800">No enviados ({panel.company.rejected.length})</p>
            {panel.company.rejected.slice(0, 5).map((item) => (
              <p key={`${item.key}:${item.at}`} className="text-xs text-brand-500">• {item.key} — {item.reason}</p>
            ))}
          </Card>
        ) : null}

        {panel.autoAvailable ? (
          <Card data-testid="sync-v2-auto-card" className="flex items-center justify-between gap-4">
            <div>
              <label htmlFor="sync-v2-auto" className="text-sm text-brand-700">Automático</label>
              <p className="text-xs text-brand-500">
                Sincroniza en segundo plano mientras la app está abierta (requiere otro dispositivo registrado).
              </p>
            </div>
            <input
              id="sync-v2-auto"
              data-testid="sync-v2-auto-toggle"
              type="checkbox"
              checked={panel.autoSync}
              onChange={(event) => panel.toggleAutoSync(event.target.checked)}
              className="h-4 w-4"
            />
          </Card>
        ) : null}
      </div>
    </div>
  );
}
