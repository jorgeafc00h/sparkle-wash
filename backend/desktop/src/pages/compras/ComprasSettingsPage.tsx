import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Mail, Key, ExternalLink, HelpCircle, Lock, Info,
  CheckCircle2, XCircle, ChevronDown, ChevronRight, Save,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Select } from '@/components/common/Select';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch, selectCurrentCompany } from '@/store';
import { selectSelectedCompanyId } from '@/store/selectors/companySelectors';
import { selectIsLite } from '@/store/selectors/subscriptionSelectors';
import { CompanyEnvironment } from '@/types/company';
import { loadCompras } from '@/store/slices/comprasSlice';
import { getGmailAccessToken, linkGmailAccount, GMAIL_RECONNECT_MESSAGE } from '@/services/compras/GmailAuthService';
import { ComprasDatabase } from '@/services/compras/ComprasDatabase';
import { ComprasSyncManager } from '@/services/compras/ComprasSyncManager';
import { GmailImportService, type SyncDateRange } from '@/services/compras/GmailImportService';
import { ImapImportService, IMAP_SECURE_SERVICE, type ImapCredentials } from '@/services/compras/ImapImportService';
import { OcrProviderSettingsCard } from '@/components/compras/OcrProviderSettingsCard';

// URLs externas — Electron intercepta window.open() y las enruta a
// shell.openExternal (ver electron/main.cjs setWindowOpenHandler).
const PROVIDER_URLS = {
  gmail2FA: 'https://myaccount.google.com/signinoptions/two-step-verification',
  gmailAppPasswords: 'https://myaccount.google.com/apppasswords',
  gmailHelpArticle: 'https://support.google.com/mail/answer/185833',
  outlook: 'https://account.live.com/proofs/AppPassword',
  yahoo: 'https://help.yahoo.com/kb/SLN15241.html',
  icloud: 'https://appleid.apple.com',
} as const;

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

type ImapTestResult =
  | { kind: 'success' }
  | { kind: 'failure'; title: string; detail: string; actionTitle?: string; actionURL?: string };

// Mapea errores de IMAP a remediación accionable en español, con deep link.
// Mirrors RN remediateImapError() and iOS ImapErrorRemediation.
function remediateImapError(error: string | undefined): ImapTestResult {
  const msg = (error || '').toLowerCase();
  if (msg.includes('auth') || msg.includes('credential') || msg.includes('login') || msg.includes('password')) {
    return {
      kind: 'failure',
      title: 'Contraseña no aceptada',
      detail:
        'La contraseña no es válida. Asegúrese de usar la contraseña de aplicación de 16 caracteres del paso 2 (no su contraseña normal de Gmail) y que la verificación en 2 pasos esté activa.',
      actionTitle: 'Crear contraseña en Google',
      actionURL: PROVIDER_URLS.gmailAppPasswords,
    };
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return {
      kind: 'failure',
      title: 'Tiempo de espera agotado',
      detail:
        'El servidor no respondió. Verifique su conexión a internet. Si está en una red corporativa o pública, el puerto 993 podría estar bloqueado por el firewall.',
    };
  }
  if (msg.includes('connect') || msg.includes('network') || msg.includes('host')) {
    return {
      kind: 'failure',
      title: 'No se pudo conectar al servidor',
      detail: `Detalle: ${error || 'error desconocido'}. Verifique el servidor y puerto en "Avanzado".`,
    };
  }
  return {
    kind: 'failure',
    title: 'Falló la conexión',
    detail: error || 'Error desconocido al conectar con el servidor IMAP.',
  };
}

// Mismos presets que en ComprasListPage para consistencia
type SyncRangePreset = 'all' | '30d' | '3m' | '6m';
const SYNC_RANGE_LABELS: Record<SyncRangePreset, string> = {
  all: 'Todo el historial',
  '30d': 'Últimos 30 días',
  '3m': 'Últimos 3 meses',
  '6m': 'Últimos 6 meses',
};
function computeSyncRange(preset: SyncRangePreset): SyncDateRange | undefined {
  if (preset === 'all') return undefined;
  const now = new Date();
  const from = new Date(now);
  if (preset === '30d') from.setDate(now.getDate() - 30);
  else if (preset === '3m') from.setMonth(now.getMonth() - 3);
  else if (preset === '6m') from.setMonth(now.getMonth() - 6);
  return { afterDate: from.toISOString().slice(0, 10) };
}

const SYNC_FREQUENCY_OPTIONS = [
  { value: '0', label: 'Manual únicamente' },
  { value: '1', label: 'Cada 1 hora' },
  { value: '6', label: 'Cada 6 horas' },
  { value: '12', label: 'Cada 12 horas' },
];

export default function ComprasSettingsPage() {
  const navigate = useNavigate();
  const toast = useToast();

  // Shared inboxes also receive DTEs issued to other companies — say so
  // instead of letting them disappear into the "ignoradas" count.
  function warnReceptorMismatch(count: number | undefined) {
    if (!count) return;
    toast.warning(
      `${count} documento(s) del buzón están a nombre de otro NIT/NRC y no se importaron en esta empresa.`,
    );
  }
  const dispatch = useAppDispatch();
  const { linkedGmailEmail, syncState } = useAppSelector((s) => s.compras);
  const selectedCompanyId = useAppSelector(selectSelectedCompanyId);
  const currentCompany = useAppSelector(selectCurrentCompany);
  const isLite = useAppSelector(selectIsLite);
  const isProduction =
    currentCompany?.environment === CompanyEnvironment.Production
    && currentCompany?.isTestAccount !== true;
  const [linkingGmail, setLinkingGmail] = useState(false);
  const [unlinkingGmail, setUnlinkingGmail] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  // Default a 30 días — consistente con el selector de ComprasListPage.
  const [syncRange, setSyncRange] = useState<SyncRangePreset>('30d');
  const [syncFrequency, setSyncFrequency] = useState(
    String(syncState?.syncFrequencyHours ?? 0)
  );

  // ─── IMAP state ─────────────────────────────────────────────────────────
  // Alternativa al flujo Gmail API para el tier Lite — sin cuota compartida,
  // sin depender de verificación OAuth de Google. Credenciales se guardan
  // encriptadas en el Keychain/DPAPI del sistema vía Electron safeStorage.
  const [imapLinked, setImapLinked] = useState<{ user: string; host?: string; port?: number } | null>(null);
  const [imapEmail, setImapEmail] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [imapHost, setImapHost] = useState('imap.gmail.com');
  const [imapPort, setImapPort] = useState('993');
  const [imapAdvanced, setImapAdvanced] = useState(false);
  const [imapShowOtherProvider, setImapShowOtherProvider] = useState(false);
  const [imapShowForm, setImapShowForm] = useState(false);
  const [imapTesting, setImapTesting] = useState(false);
  const [imapSaving, setImapSaving] = useState(false);
  const [imapSyncing, setImapSyncing] = useState(false);
  const [imapUnlinking, setImapUnlinking] = useState(false);
  const [imapLoaded, setImapLoaded] = useState(false);
  const [imapTestResult, setImapTestResult] = useState<ImapTestResult | null>(null);
  const [imapTestedFingerprint, setImapTestedFingerprint] = useState<string | null>(null);
  const [imapResolvedConfig, setImapResolvedConfig] = useState<{ host?: string; port?: number } | null>(null);

  const isNonGmailEmail = useMemo(() => {
    if (!imapEmail.includes('@')) return false;
    return !imapEmail.toLowerCase().endsWith('@gmail.com');
  }, [imapEmail]);

  // Servidor/puerto/SSL auto-detectados a partir del dominio del correo —
  // solo informativo mientras "Avanzado" está cerrado (ver hint debajo del
  // campo de contraseña). La conexión real vuelve a resolver esto server-side.
  const detectedImapSettings = useMemo(
    () => ImapImportService.detectImapSettings(imapEmail),
    [imapEmail],
  );

  const imapCurrentFingerprint = useMemo(() => JSON.stringify({
    user: imapEmail.trim().toLowerCase(),
    password: imapPassword,
    host: imapAdvanced && imapHost ? imapHost.trim().toLowerCase() : '',
    port: imapAdvanced && imapPort ? Number(imapPort) : '',
  }), [imapAdvanced, imapEmail, imapHost, imapPassword, imapPort]);

  const imapCanSave =
    imapTestResult?.kind === 'success' && imapTestedFingerprint === imapCurrentFingerprint;

  function invalidateImapTest() {
    setImapTestResult(null);
    setImapTestedFingerprint(null);
    setImapResolvedConfig(null);
  }

  function handleImapEmailChange(value: string) {
    setImapEmail(value);
    invalidateImapTest();
  }

  // Quita espacios/saltos — Google muestra la contraseña como
  // "abcd efgh ijkl mnop" y los usuarios pegan los espacios, causando auth fail.
  function handleImapPasswordChange(raw: string) {
    setImapPassword(raw.replace(/\s+/g, ''));
    invalidateImapTest();
  }

  function handleImapHostChange(value: string) {
    setImapHost(value);
    invalidateImapTest();
  }

  function handleImapPortChange(value: string) {
    setImapPort(value);
    invalidateImapTest();
  }

  function handleImapAdvancedToggle() {
    setImapAdvanced((current) => !current);
    invalidateImapTest();
  }

  useEffect(() => {
    if (imapLoaded || !selectedCompanyId) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.secureGet) {
      setImapLoaded(true);
      return;
    }
    (async () => {
      try {
        const raw = await api.secureGet!(IMAP_SECURE_SERVICE, selectedCompanyId);
        if (raw) {
          const parsed = JSON.parse(raw) as ImapCredentials;
          setImapLinked({ user: parsed.user, host: parsed.host, port: parsed.port });
          setImapEmail(parsed.user);
          setImapHost(parsed.host ?? '');
          setImapPort(String(parsed.port ?? 993));
        }
      } catch {
        /* credenciales corruptas/ausentes — ignorar */
      } finally {
        setImapLoaded(true);
      }
    })();
  }, [selectedCompanyId, imapLoaded]);

  function buildImapCreds(): ImapCredentials {
    return {
      user: imapEmail.trim(),
      password: imapPassword,
      host: imapAdvanced && imapHost ? imapHost.trim() : undefined,
      port: imapAdvanced && imapPort ? Number(imapPort) : undefined,
    };
  }

  async function handleTestImapConnection() {
    if (!imapEmail || !imapPassword) return;
    setImapTesting(true);
    setImapTestResult(null);
    try {
      const fingerprint = imapCurrentFingerprint;
      const result = await ImapImportService.testConnection(buildImapCreds());
      if (result.ok) {
        setImapTestResult({ kind: 'success' });
        setImapTestedFingerprint(fingerprint);
        setImapResolvedConfig({ host: result.host, port: result.port });
      } else {
        setImapTestResult(remediateImapError(result.error));
        setImapTestedFingerprint(null);
        setImapResolvedConfig(null);
      }
    } catch (err) {
      setImapTestResult(remediateImapError((err as Error)?.message));
      setImapTestedFingerprint(null);
      setImapResolvedConfig(null);
    } finally {
      setImapTesting(false);
    }
  }

  async function handleSaveImapCredentials() {
    if (!selectedCompanyId) { toast.error('Selecciona una empresa'); return; }
    if (!imapEmail || !imapPassword) {
      toast.error('Ingresa email y contraseña de aplicación');
      return;
    }
    if (!imapCanSave) {
      toast.error('Primero prueba la conexión IMAP');
      return;
    }
    setImapSaving(true);
    try {
      const creds = buildImapCreds();
      const host = imapResolvedConfig?.host ?? creds.host;
      const port = imapResolvedConfig?.port ?? creds.port;
      const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (!api?.secureSet) { toast.error('Almacenamiento seguro no disponible'); return; }
      await api.secureSet(
        IMAP_SECURE_SERVICE,
        selectedCompanyId,
        JSON.stringify({ ...creds, host, port }),
      );
      setImapLinked({ user: creds.user, host, port });
      setImapPassword('');
      setImapShowForm(false);
      setImapTestResult(null);
      setImapTestedFingerprint(null);
      setImapResolvedConfig(null);
      toast.success(`IMAP conectado: ${creds.user} @ ${host}:${port}`);
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Error al guardar credenciales IMAP');
    } finally {
      setImapSaving(false);
    }
  }

  async function handleUnlinkImap() {
    if (!selectedCompanyId) return;
    setImapUnlinking(true);
    try {
      const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
      await api?.secureDelete?.(IMAP_SECURE_SERVICE, selectedCompanyId);
      setImapLinked(null);
      setImapEmail('');
      setImapHost('imap.gmail.com');
      setImapPort('993');
      setImapAdvanced(false);
      setImapShowOtherProvider(false);
      setImapTestResult(null);
      toast.success('IMAP desvinculado');
    } catch (err) {
      toast.error((err as Error)?.message ?? 'No se pudo desvincular IMAP');
    } finally {
      setImapUnlinking(false);
    }
  }

  async function handleImapSyncNow() {
    if (!selectedCompanyId || !imapLinked) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.secureGet) { toast.error('Almacenamiento seguro no disponible'); return; }
    setImapSyncing(true);
    try {
      const raw = await api.secureGet(IMAP_SECURE_SERVICE, selectedCompanyId);
      if (!raw) { toast.error('No se encontraron credenciales IMAP'); return; }
      const creds = JSON.parse(raw) as ImapCredentials;
      const dateRange = computeSyncRange(syncRange);
      const result = await ImapImportService.syncComprasForCompany(
        selectedCompanyId,
        creds,
        dateRange,
        { autoVerify: true, isProduction },
      );
      if (result.authError) {
        toast.error(result.errorMessage ?? 'Credenciales IMAP inválidas');
      } else if (result.errors > 0 && result.imported === 0) {
        toast.error(result.errorMessage ?? `${result.errors} errores durante la sincronización`);
      } else {
        toast.success(
          `IMAP (${SYNC_RANGE_LABELS[syncRange]}): ${result.imported} importadas, ${result.skipped} ignoradas, ${result.errors} errores`,
        );
        warnReceptorMismatch(result.receptorMismatch);
      }
      dispatch(loadCompras(selectedCompanyId));
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Error al sincronizar IMAP');
    } finally {
      setImapSyncing(false);
    }
  }

  async function handleSyncNow() {
    if (!selectedCompanyId) {
      toast.error('No hay empresa seleccionada');
      return;
    }
    setSyncingNow(true);
    try {
      const linked = await ComprasDatabase.getLinkedGmail(selectedCompanyId);
      if (!linked) {
        toast.error('No hay una cuenta de Gmail vinculada. Conecta primero.');
        return;
      }
      // Renews an expired token; asks Google again only if it was revoked.
      const token = await getGmailAccessToken(selectedCompanyId, { interactive: true });
      if (!token) {
        toast.error(GMAIL_RECONNECT_MESSAGE);
        return;
      }
      const dateRange = computeSyncRange(syncRange);
      const result = await GmailImportService.syncComprasForCompany(
        selectedCompanyId,
        token,
        dateRange,
        { autoVerify: true, isProduction },
      );
      if (result.authError) {
        toast.error(
          result.errorMessage ?? 'Error de autenticación con Gmail. Vuelve a conectar la cuenta.',
        );
      } else if (result.quotaExceeded) {
        toast.error(
          `${result.errorMessage ?? 'Cuota diaria de Gmail API agotada.'} Actualiza a Pro o usa IMAP.`,
        );
      } else if (result.errors > 0 && result.imported === 0) {
        toast.error(
          result.errorMessage ??
            `${result.errors} errores durante la sincronización, nada importado`,
        );
      } else {
        toast.success(
          `Sincronización (${SYNC_RANGE_LABELS[syncRange]}): ${result.imported} importadas, ${result.skipped} ignoradas, ${result.errors} errores`,
        );
        warnReceptorMismatch(result.receptorMismatch);
      }
      dispatch(loadCompras(selectedCompanyId));
    } catch (err: any) {
      toast.error(err?.message ?? 'Error al sincronizar');
    } finally {
      setSyncingNow(false);
    }
  }

  async function linkGmailFlow(forceReauth: boolean) {
    if (!selectedCompanyId) {
      toast.error('No hay empresa seleccionada');
      return;
    }
    setLinkingGmail(true);
    try {
      // Switching accounts opens the Google picker without an account hint;
      // otherwise the app's Google session is reused when it can read Gmail.
      const { email } = await linkGmailAccount(selectedCompanyId, { switchAccount: forceReauth });
      toast.success(`Gmail vinculado: ${email}`);
      dispatch(loadCompras(selectedCompanyId));
    } catch (err: any) {
      toast.error(err?.message ?? 'Error al vincular Gmail');
    } finally {
      setLinkingGmail(false);
    }
  }

  const handleLinkGmail = () => linkGmailFlow(false);
  const handleSwitchGmail = () => linkGmailFlow(true);

  async function handleUnlinkGmail() {
    if (!selectedCompanyId) return;
    setUnlinkingGmail(true);
    try {
      await ComprasDatabase.unlinkGmail(selectedCompanyId);
      toast.success('Gmail desvinculado');
      dispatch(loadCompras(selectedCompanyId));
    } catch (err: any) {
      toast.error(err?.message ?? 'Error al desvincular Gmail');
    } finally {
      setUnlinkingGmail(false);
    }
  }

  function handleFrequencyChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const freq = Number(e.target.value);
    setSyncFrequency(String(freq));
    if (!selectedCompanyId) return;
    if (freq > 0) {
      ComprasSyncManager.startForCompany(selectedCompanyId, freq, (result, error) => {
        if (error) {
          console.error('ComprasSyncManager error:', error);
        } else if (result) {
          console.log(`Sync completado: ${result.imported} importadas`);
        }
      });
    } else {
      ComprasSyncManager.stop();
    }
    toast.success('Frecuencia de sincronización actualizada');
  }

  return (
    <div data-testid="compras-settings" className="max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader
        title="Configuración de Compras"
        subtitle="Ajustes de sincronización y fuentes de datos"
        onBack={() => navigate(-1)}
      />

      {/* Gmail OAuth — alternativa secundaria. IMAP es el método recomendado
          (sin cuota compartida de Google, funciona con cualquier proveedor).
          Usamos `order-3` para que aparezca DESPUÉS del card IMAP en flex. */}
      <Card className="space-y-4 order-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-brand-800">Alternativa: Google OAuth</h2>
          {linkedGmailEmail ? (
            <Badge variant="success">Conectado</Badge>
          ) : (
            <Badge variant="neutral">Sin conectar</Badge>
          )}
        </div>
        <p className="text-xs text-brand-400">
          Inicio de sesión con Google en un clic. Úsalo solo si IMAP no funciona para tu proveedor.
        </p>

        {/* Advertencias obligatorias — Testing mode de Google impone fricciones
            que el usuario debe conocer antes de vincular. */}
        <div
          className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-xs text-amber-900 space-y-2"
          data-testid="compras-settings-gmail-warnings"
        >
          <div className="flex gap-2">
            <span aria-hidden>⚠️</span>
            <p>
              Google mostrará una pantalla <strong>"app no verificada"</strong> — toca
              "Configuración avanzada" y luego "Ir a Facturas Simples (no seguro)".
            </p>
          </div>
          <div className="flex gap-2">
            <span aria-hidden>⏱️</span>
            <p>
              Tendrás que <strong>volver a iniciar sesión cada 7 días</strong> (restricción de
              Google mientras la app está en verificación).
            </p>
          </div>
          <div className="flex gap-2">
            <span aria-hidden>👥</span>
            <p>
              Límite temporal de 100 usuarios vinculados. Para uso continuo sin esta fricción,
              usa IMAP arriba.
            </p>
          </div>
        </div>

        {linkedGmailEmail ? (
          <div className="space-y-3">
            <p className="text-sm text-brand-700">
              Cuenta vinculada: <span className="font-medium">{linkedGmailEmail}</span>
            </p>
            {syncState && (
              <div className="text-sm text-brand-500 space-y-1">
                <p>Estado: <Badge variant={syncState.status === 'syncing' ? 'info' : syncState.status === 'error' ? 'error' : 'success'}>
                  {syncState.status === 'syncing' ? 'Sincronizando' : syncState.status === 'error' ? 'Error' : 'Inactivo'}
                </Badge></p>
                {syncState.lastSyncAt && (
                  <p>Última sincronización: {new Date(syncState.lastSyncAt).toLocaleString('es-SV')}</p>
                )}
                <p>Total importadas: {syncState.totalImported}</p>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col text-xs text-brand-600">
                <span className="mb-1">Rango de sincronización</span>
                <select
                  className="rounded-md border border-brand-200 bg-white px-2 py-2 text-sm"
                  value={syncRange}
                  onChange={(e) => setSyncRange(e.target.value as SyncRangePreset)}
                  disabled={syncingNow}
                  data-testid="compras-settings-sync-range"
                >
                  {(Object.keys(SYNC_RANGE_LABELS) as SyncRangePreset[]).map((key) => (
                    <option key={key} value={key}>{SYNC_RANGE_LABELS[key]}</option>
                  ))}
                </select>
              </label>
              <Button
                variant="primary"
                icon={
                  syncingNow ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )
                }
                loading={syncingNow}
                onClick={handleSyncNow}
                data-testid="compras-settings-sync-now"
              >
                Sincronizar ahora
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                loading={linkingGmail}
                onClick={handleSwitchGmail}
              >
                Cambiar cuenta
              </Button>
              <Button
                variant="danger"
                loading={unlinkingGmail}
                onClick={handleUnlinkGmail}
              >
                Desconectar Gmail
              </Button>
            </div>
            <p className="text-xs text-brand-400">
              Puedes vincular una cuenta de Gmail diferente para cada empresa.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-brand-500">
              Conecta tu cuenta Gmail para importar automáticamente los DTEs que recibes por correo.
            </p>
            <Button
              variant="primary"
              loading={linkingGmail}
              onClick={handleLinkGmail}
            >
              Conectar con Gmail
            </Button>
          </div>
        )}
      </Card>

      {/* Sync Frequency — sits between IMAP (order-1) and Gmail (order-3). */}
      {/* Sync Frequency — Pro-only. Lite users see a paywall nudge because
          la cuota diaria de Gmail API es compartida entre todos los usuarios
          gratis; permitir sync frecuente rompería la experiencia de todos. */}
      <Card className="space-y-4 order-2">
        <h2 className="font-semibold text-brand-800">Frecuencia de Sincronización</h2>
        {isLite ? (
          <div className="space-y-2">
            <p className="text-sm text-brand-500">
              En el plan gratuito la sincronización de Gmail está limitada a 1 vez cada 24 horas.
              Actualiza a Pro para sincronizar cada 1/6/12 horas, o usa IMAP sin restricción de frecuencia.
            </p>
            <Badge variant="warning">Solo en Pro</Badge>
          </div>
        ) : (
          <>
            <p className="text-sm text-brand-500">
              Configura con qué frecuencia se revisa tu bandeja de entrada en busca de nuevos DTEs.
              Solo disponible para empresas en modo Producción.
            </p>
            <Select
              label="Frecuencia"
              options={SYNC_FREQUENCY_OPTIONS}
              value={syncFrequency}
              onChange={handleFrequencyChange}
            />
          </>
        )}
      </Card>

      {/* Conectar Gmail por IMAP — wizard Gmail-first (paridad con RN/iOS).
          `order-1` lo posiciona primero. */}
      <Card className="space-y-3 order-1 ring-2 ring-red-400/30" data-testid="compras-settings-imap-card">
        {/* Hero */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Mail size={22} className="text-red-600" />
            <h2 className="font-semibold text-brand-800">Conectar Gmail</h2>
            <Badge variant="success">Recomendado</Badge>
          </div>
          {imapLinked ? (
            <Badge variant="success">Conectado</Badge>
          ) : (
            <Badge variant="neutral">Sin conectar</Badge>
          )}
        </div>

        {!imapLinked && !imapShowForm && (
          <>
            <p className="text-sm text-brand-500">
              Importa facturas desde tu Gmail en 3 pasos (tarda 2 minutos). Solo lee correos con
              facturas adjuntas — nunca envía ni borra mensajes.
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 w-fit">
              <Lock size={11} aria-hidden="true" />
              Encriptado
            </span>
          </>
        )}

        {imapLinked ? (
          <>
            <div className="text-sm text-brand-700">
              <div>Cuenta: <span className="font-medium" data-testid="compras-settings-imap-email">{imapLinked.user}</span></div>
              {imapLinked.host && (
                <div className="text-xs text-brand-500">
                  Servidor: {imapLinked.host}:{imapLinked.port ?? 993}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon={imapSyncing ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                loading={imapSyncing}
                onClick={handleImapSyncNow}
                data-testid="compras-settings-imap-sync"
              >
                Sincronizar ahora
              </Button>
              <Button
                variant="danger"
                loading={imapUnlinking}
                onClick={handleUnlinkImap}
                data-testid="compras-settings-imap-unlink"
              >
                Desconectar IMAP
              </Button>
            </div>
          </>
        ) : !imapShowForm ? (
          <button
            type="button"
            onClick={() => setImapShowForm(true)}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors w-fit"
            data-testid="compras-settings-imap-start"
          >
            <Mail size={16} />
            Empezar configuración
          </button>
        ) : (
          <>
            {/* Paso 1 — Activar 2FA */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">1</span>
                <h3 className="font-semibold text-sm text-brand-800">Activa la verificación en 2 pasos</h3>
              </div>
              <p className="text-xs text-brand-500 ml-8">
                Si todavía no la tienes activada en tu cuenta de Google, hazlo primero. Es
                obligatorio para crear la contraseña de aplicación.
              </p>
              <button
                type="button"
                onClick={() => openExternal(PROVIDER_URLS.gmail2FA)}
                className="ml-8 inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 transition-colors"
                data-testid="compras-settings-imap-open-2fa"
              >
                <ExternalLink size={13} />
                Abrir configuración de Google
              </button>
            </div>

            {/* Paso 2 — Crear contraseña de aplicación */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">2</span>
                <h3 className="font-semibold text-sm text-brand-800">Crea una contraseña de aplicación</h3>
              </div>
              <p className="text-xs text-brand-500 ml-8">
                Google generará una contraseña de <strong>16 caracteres</strong> exclusiva para
                Car Spa. Escribe <strong>"Car Spa"</strong> como nombre cuando te lo pida.
              </p>
              <button
                type="button"
                onClick={() => openExternal(PROVIDER_URLS.gmailAppPasswords)}
                className="ml-8 inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 transition-colors"
                data-testid="compras-settings-imap-open-apppasswords"
              >
                <Key size={13} />
                Abrir contraseñas de aplicación
              </button>
              <p className="ml-8 text-xs italic text-brand-400">
                Tip: copia la contraseña apenas la veas — Google no la mostrará otra vez.
              </p>
            </div>

            {/* Paso 3 — Pegar credenciales */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">3</span>
                <h3 className="font-semibold text-sm text-brand-800">Pega tu correo y contraseña</h3>
              </div>
              <div className="ml-8 grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex flex-col text-xs text-brand-600">
                  <span className="mb-1">Tu correo de Gmail</span>
                  <input
                    type="email"
                    value={imapEmail}
                    onChange={(e) => handleImapEmailChange(e.target.value)}
                    placeholder="usuario@gmail.com"
                    className="rounded-md border border-brand-200 bg-white px-3 py-2 text-sm"
                    autoComplete="username"
                    disabled={imapTesting || imapSaving}
                    data-testid="compras-settings-imap-email-input"
                  />
                </label>
                <label className="flex flex-col text-xs text-brand-600">
                  <span className="mb-1">Contraseña de aplicación (16 caracteres)</span>
                  <input
                    type="password"
                    value={imapPassword}
                    onChange={(e) => handleImapPasswordChange(e.target.value)}
                    placeholder="abcdefghijklmnop"
                    className="rounded-md border border-brand-200 bg-white px-3 py-2 text-sm"
                    autoComplete="current-password"
                    disabled={imapTesting || imapSaving}
                    data-testid="compras-settings-imap-password-input"
                  />
                </label>
              </div>
              {imapPassword.length > 0 && (
                <div
                  className="ml-8 flex items-center gap-1.5 text-xs"
                  data-testid="compras-settings-imap-password-hint"
                >
                  {imapPassword.length === 16 ? (
                    <>
                      <CheckCircle2 size={13} className="text-green-600" />
                      <span className="text-brand-500">16 caracteres — formato correcto</span>
                    </>
                  ) : (
                    <>
                      <Info size={13} className="text-amber-500" />
                      <span className="text-brand-500">
                        {imapPassword.length} de 16 caracteres. Asegúrese de pegar la contraseña completa.
                      </span>
                    </>
                  )}
                </div>
              )}
              <p className="ml-8 text-xs text-brand-400">
                <strong>No uses tu contraseña normal de Gmail</strong> — solo la contraseña de
                aplicación del paso 2. Los espacios se quitan automáticamente al pegar.
              </p>
              {/* Servidor/puerto/SSL auto-detectados a partir del dominio del
                  correo — solo informativo mientras "Avanzado" está cerrado;
                  la resolución que realmente se usa al conectar vive en
                  electron/main.cjs (imapAutoDetect) y se confirma al Probar. */}
              {!imapAdvanced && imapEmail.includes('@') && (
                <p
                  className="ml-8 text-xs text-brand-400"
                  data-testid="compras-settings-imap-detected-hint"
                >
                  Detectado automáticamente: {detectedImapSettings.server}:{detectedImapSettings.port}
                  {detectedImapSettings.ssl ? ' (SSL)' : ''}
                </p>
              )}
            </div>

            {/* Aviso para correo no-Gmail */}
            {isNonGmailEmail && (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-xs"
                data-testid="compras-settings-imap-non-gmail-notice"
              >
                <Info size={16} className="mt-0.5 flex-shrink-0 text-amber-600" />
                <div>
                  <div className="font-semibold text-amber-900">¿No es una cuenta de Gmail?</div>
                  <div className="mt-0.5 text-amber-800">
                    Para Outlook, Yahoo o iCloud, expande "Avanzado" abajo y usa "Otro proveedor".
                  </div>
                </div>
              </div>
            )}

            {/* Resultado de la prueba — success/error con remediación */}
            {imapTestResult?.kind === 'success' && (
              <div
                className="flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm font-medium text-green-700"
                data-testid="compras-settings-imap-result-success"
              >
                <CheckCircle2 size={16} className="shrink-0" />
                <span>
                  Conexión exitosa. Aún no se ha guardado: pulsa{' '}
                  <strong>Guardar configuración</strong> para conservarla.
                </span>
              </div>
            )}
            {imapTestResult?.kind === 'failure' && (
              <div
                className="space-y-2 rounded-md border border-red-200 bg-red-50/50 p-3"
                data-testid="compras-settings-imap-result-failure"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                  <XCircle size={16} />
                  {imapTestResult.title}
                </div>
                <p className="text-xs text-brand-500">{imapTestResult.detail}</p>
                {imapTestResult.actionTitle && imapTestResult.actionURL && (
                  <button
                    type="button"
                    onClick={() => openExternal(imapTestResult.actionURL!)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors"
                    data-testid="compras-settings-imap-result-action"
                  >
                    <ExternalLink size={12} />
                    {imapTestResult.actionTitle}
                  </button>
                )}
              </div>
            )}

            {/* Probar / Guardar / Cancelar */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                variant="secondary"
                loading={imapTesting}
                onClick={handleTestImapConnection}
                disabled={!imapEmail || !imapPassword || imapSaving}
                data-testid="compras-settings-imap-test"
              >
                Probar
              </Button>
              <Button
                variant="primary"
                loading={imapSaving}
                onClick={handleSaveImapCredentials}
                disabled={!imapCanSave || imapTesting}
                icon={imapSaving ? undefined : <Save size={16} />}
                data-testid="compras-settings-imap-save"
              >
                Guardar configuración
              </Button>
              <button
                type="button"
                onClick={() => {
                  setImapShowForm(false);
                  setImapTestResult(null);
                }}
                className="ml-auto text-xs text-brand-500 hover:text-brand-700 underline"
              >
                Cancelar
              </button>
            </div>
            {imapEmail && imapPassword && !imapCanSave && (
              <p className="text-xs text-brand-400" data-testid="compras-settings-imap-save-hint">
                Primero prueba la conexión. Solo se puede guardar una configuración validada.
              </p>
            )}

            {/* Avanzado — otros proveedores + servidor manual */}
            <button
              type="button"
              onClick={handleImapAdvancedToggle}
              className="flex items-center gap-1.5 pt-2 text-xs font-semibold text-brand-500 hover:text-brand-700 border-t border-brand-100 mt-2"
              data-testid="compras-settings-imap-toggle-advanced"
            >
              {imapAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Avanzado
            </button>
            {imapAdvanced && (
              <div className="pl-4 space-y-3 border-l-2 border-brand-100">
                <button
                  type="button"
                  onClick={() => setImapShowOtherProvider(!imapShowOtherProvider)}
                  className="flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:text-brand-700"
                >
                  {imapShowOtherProvider ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Otro proveedor (Outlook, Yahoo, iCloud)
                </button>
                {imapShowOtherProvider && (
                  <div className="space-y-2 pl-4">
                    <p className="text-xs text-brand-500">
                      Cada proveedor tiene su propia página para generar contraseñas de aplicación:
                    </p>
                    <button
                      type="button"
                      onClick={() => openExternal(PROVIDER_URLS.outlook)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-white px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50 transition-colors mr-2"
                    >
                      <ExternalLink size={12} />
                      Outlook / Hotmail
                    </button>
                    <button
                      type="button"
                      onClick={() => openExternal(PROVIDER_URLS.yahoo)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-white px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50 transition-colors mr-2"
                    >
                      <ExternalLink size={12} />
                      Yahoo
                    </button>
                    <button
                      type="button"
                      onClick={() => openExternal(PROVIDER_URLS.icloud)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-white px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50 transition-colors"
                    >
                      <ExternalLink size={12} />
                      iCloud
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="flex flex-col text-xs text-brand-600">
                    <span className="mb-1">Servidor IMAP</span>
                    <input
                      type="text"
                      value={imapHost}
                      onChange={(e) => handleImapHostChange(e.target.value)}
                      placeholder="imap.gmail.com"
                      className="rounded-md border border-brand-200 bg-white px-3 py-2 text-sm"
                      data-testid="compras-settings-imap-host-input"
                    />
                  </label>
                  <label className="flex flex-col text-xs text-brand-600">
                    <span className="mb-1">Puerto</span>
                    <input
                      type="number"
                      value={imapPort}
                      onChange={(e) => handleImapPortChange(e.target.value)}
                      placeholder="993"
                      className="rounded-md border border-brand-200 bg-white px-3 py-2 text-sm"
                      data-testid="compras-settings-imap-port-input"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Help footer */}
            <button
              type="button"
              onClick={() => openExternal(PROVIDER_URLS.gmailHelpArticle)}
              className="flex items-center gap-1.5 pt-3 text-xs font-medium text-brand-500 hover:text-brand-700 border-t border-brand-100 mt-2"
              data-testid="compras-settings-imap-help"
            >
              <HelpCircle size={13} />
              Ayuda oficial de Google sobre contraseñas de aplicación
            </button>
          </>
        )}
      </Card>

      <OcrProviderSettingsCard />
    </div>
  );
}
