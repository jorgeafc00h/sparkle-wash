import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ShoppingBag, RefreshCw, Mail, Settings, ShieldCheck, Sparkles, Image as ImageIcon } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { DataTable, ColumnDef } from '@/components/common/DataTable';
import { SearchBar } from '@/components/common/SearchBar';
import { StickyToolbar } from '@/components/common/StickyToolbar';
import { EmptyState } from '@/components/common/EmptyState';
import { Input } from '@/components/common/Input';
import { useToast } from '@/components/common/Toast';
import { ImportFromImageModal } from '@/components/modals/ImportFromImageModal';
import { useAppSelector, useAppDispatch } from '@/store';
import { loadCompras, setSearchTerm, setDateRange, initComprasDatabase, syncComprasNow } from '@/store/slices/comprasSlice';
import { selectCurrentCompany } from '@/store';
import { getGmailAccessToken, linkGmailAccount, GMAIL_RECONNECT_MESSAGE } from '@/services/compras/GmailAuthService';
import { ComprasDatabase } from '@/services/compras/ComprasDatabase';
import { ComprasSyncManager } from '@/services/compras/ComprasSyncManager';
import { isCompraLinked } from '@/services/compras/compraLinks';
import { GmailImportService, type SyncDateRange } from '@/services/compras/GmailImportService';
import { CompraVerificationService } from '@/services/compras/CompraVerificationService';
import { selectIsLite } from '@/store/selectors/subscriptionSelectors';
import { Compra, CompraSource } from '@/types/compras';
import { CompanyEnvironment, type Company } from '@/types/company';

// Guarda contra NaN/Infinity y clampa a [0,1] — mismo patrón que
// safeProgress/safePercentage en el ProgressViews.swift de referencia.
function safeProgressFraction(current: number, total: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return 0;
  const fraction = current / total;
  if (!Number.isFinite(fraction)) return 0;
  return Math.max(0, Math.min(1, fraction));
}

// Cooldown entre sincronizaciones manuales para el tier Lite (free).
// Después de una sync exitosa, el usuario debe esperar 24h para volver a
// sincronizar. Pro/AdFree no tienen cooldown.
const LITE_SYNC_COOLDOWN_HOURS = 24;

function formatRemainingHours(ms: number): string {
  if (ms <= 0) return '0h';
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  return hours === 1 ? '1 hora' : `${hours} horas`;
}

// Una empresa se considera productiva cuando está en env PRODUCTION y no
// está marcada como isTestAccount. Misma lógica que `isProductionCompany`
// en la app React Native.
function isProductionCompany(company: Company | null | undefined): boolean {
  if (!company) return false;
  return company.environment === CompanyEnvironment.Production && company.isTestAccount !== true;
}

// Presets para el rango de fechas de sincronización.
// "all" = sin filtro (todos los correos con adjuntos).
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

type CompraRow = Record<string, unknown> & {
  id: string;
  fecha: string;
  emisorLabel: string;
  tipoDte: string;
  totalPagar: number;
  source: CompraSource;
  verified: boolean | undefined;
  linked: boolean;
  internalUse: boolean;
};

function toRow(c: Compra): CompraRow {
  return {
    id: c.id,
    fecha: c.fecha,
    emisorLabel: `${c.emisorNit} — ${c.emisorNombre}`,
    tipoDte: c.tipoDte,
    totalPagar: c.totalPagar,
    source: c.source,
    verified: c.verified,
    linked: isCompraLinked(c),
    internalUse: c.internalUse === true,
  };
}

const SOURCE_LABELS: Record<CompraSource, string> = {
  [CompraSource.Email]: 'Email',
  [CompraSource.OCR]: 'OCR',
  [CompraSource.Manual]: 'Manual',
};

const SOURCE_VARIANTS: Record<CompraSource, 'info' | 'purple' | 'neutral'> = {
  [CompraSource.Email]: 'info',
  [CompraSource.OCR]: 'purple',
  [CompraSource.Manual]: 'neutral',
};

export default function ComprasListPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();

  // Shared inboxes also receive DTEs issued to other companies — say so
  // instead of letting them disappear into the "ignoradas" count.
  function warnReceptorMismatch(count: number | undefined) {
    if (!count) return;
    toast.warning(
      `${count} documento(s) del buzón están a nombre de otro NIT/NRC y no se importaron en esta empresa.`,
    );
  }

  const currentCompany = useAppSelector(selectCurrentCompany);
  const isLite = useAppSelector(selectIsLite);
  const {
    compras, loading, searchTerm, dateFrom, dateTo, monthlyTotal, dbInitialized, linkedGmailEmail,
    isSyncing, syncProgress,
    // Renamed on destructure — the "Verificar compras" batch button below
    // already owns local state named `verifyProgress`/`isVerifying`-like
    // vars; these two track the DEFERRED IMAP verify pass instead.
    isVerifying: isVerifyingImap, verifyProgress: imapVerifyProgress,
    newPurchasesCount, syncError,
  } = useAppSelector((s) => s.compras);

  const [localSearch, setLocalSearch] = useState(searchTerm);
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [usoFilter, setUsoFilter] = useState<'all' | 'internal' | 'dte'>('all');
  const [verifyProgress, setVerifyProgress] = useState<{ current: number; total: number } | null>(null);
  // Default a 90 días (3m): cubre el periodo fiscal reciente y suele
  // devolver la mayoría de las compras importantes del usuario en la
  // primera sincronización. El primer sync (lista vacía) fuerza 3m sin
  // importar el preset seleccionado.
  const [syncRange, setSyncRange] = useState<SyncRangePreset>('3m');
  const [showImageImport, setShowImageImport] = useState(false);

  // Forzar re-autenticación: limpia el token guardado y abre el flujo de Google
  // para obtener uno nuevo con los scopes actuales (incl. gmail.readonly).
  // Útil cuando el usuario está recibiendo 401 Unauthorized en la sincronización.
  async function handleReconnectGmail() {
    if (!currentCompany) {
      toast.error('Selecciona una empresa para conectar Gmail');
      return;
    }
    setConnectingGmail(true);
    try {
      // Abre siempre la pantalla de Google (no reutiliza la sesión) y
      // reemplaza el vínculo de Gmail de esta empresa.
      const { email } = await linkGmailAccount(currentCompany.id, { reauthorize: true });
      toast.success(`Gmail reconectado: ${email}`);
      dispatch(loadCompras(currentCompany.id));
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Error al reconectar Gmail');
    } finally {
      setConnectingGmail(false);
    }
  }

  // Sincroniza con la fuente PREFERIDA de la empresa: IMAP si hay
  // credenciales guardadas (ver Ajustes de compras), Gmail como respaldo.
  // Wire del botón principal "Sincronizar" — dirige el thunk que va
  // despachando progreso a la slice (compras.syncingBanner / .verifyingBanner).
  async function handleSyncPreferred() {
    if (!currentCompany) {
      toast.error('Selecciona una empresa para sincronizar');
      return;
    }
    const hasImap = await ComprasSyncManager.hasImapCredentials(currentCompany.id);
    // El cooldown de 24h del tier Lite protege la cuota COMPARTIDA de Gmail
    // API — no aplica a IMAP (sin cuota compartida), así que solo se
    // verifica cuando la sync va a resolver a Gmail.
    if (!hasImap && isLite) {
      const last = await ComprasDatabase.getLastManualSync(currentCompany.id);
      const remainingMs = ComprasDatabase.msUntilNextLiteSync(last, LITE_SYNC_COOLDOWN_HOURS);
      if (remainingMs > 0) {
        toast.error(
          `Tu plan gratuito permite 1 sincronización de Gmail cada 24h. Intenta en ${formatRemainingHours(remainingMs)}, o conecta IMAP en Ajustes para sincronizar sin límite.`,
        );
        return;
      }
    }
    const isFirstSync = compras.length === 0;
    const dateRange = computeSyncRange(isFirstSync ? '3m' : syncRange);
    const action = await dispatch(
      syncComprasNow({
        companyId: currentCompany.id,
        dateRange,
        isProduction: isProductionCompany(currentCompany),
      }),
    );
    if (syncComprasNow.fulfilled.match(action)) {
      warnReceptorMismatch(action.payload.receptorMismatch);
    }
    if (syncComprasNow.fulfilled.match(action) && !hasImap) {
      const result = action.payload;
      if (result.source === 'gmail' && !result.authError && !result.quotaExceeded) {
        await ComprasDatabase.setLastManualSync(currentCompany.id, new Date().toISOString());
      }
    }
  }

  // Verifica en batch TODAS las compras contra la Consulta Pública del MH.
  // Cada click re-verifica la lista completa — útil para detectar cambios
  // posteriores a la primera verificación (invalidaciones, estado actualizado,
  // o tampering del JSON local vs lo que el MH tiene registrado).
  async function handleVerifyAll() {
    if (!currentCompany) {
      toast.error('Selecciona una empresa para verificar');
      return;
    }
    // Uso interno no se consulta al MH.
    const verifiable = compras.filter((c) => c.internalUse !== true);
    if (verifiable.length === 0) {
      toast.info('No hay compras para verificar');
      return;
    }
    setVerifyingAll(true);
    setVerifyProgress({ current: 0, total: verifiable.length });
    try {
      const isProduction = isProductionCompany(currentCompany);
      const verified = await CompraVerificationService.verifyBatch(
        verifiable,
        isProduction,
        (current, total) => setVerifyProgress({ current, total }),
      );
      for (const v of verified) {
        await ComprasDatabase.insertCompra(v);
      }
      // verified = MH confirmó recepción. Diferencias de monto se ven en el
      // detalle, no afectan el conteo de válidas.
      const okCount = verified.filter((c) => c.verified === true).length;
      const notFound = verified.filter(
        (c) => c.verified === false && c.verifiedEstado === 'NO_ENCONTRADO',
      ).length;
      const other = verified.length - okCount - notFound;
      const parts = [`${okCount} válidas`];
      if (notFound > 0) parts.push(`${notFound} no encontradas`);
      if (other > 0) parts.push(`${other} otras`);
      toast.success(`Verificación completa: ${parts.join(', ')} (de ${verified.length})`);
      dispatch(loadCompras(currentCompany.id));
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Error al verificar');
    } finally {
      setVerifyingAll(false);
      setVerifyProgress(null);
    }
  }

  async function handleGmailSync() {
    if (!currentCompany) {
      toast.error('Selecciona una empresa para sincronizar');
      return;
    }
    // Rate limit del tier Lite: 1 sync manual cada 24h — evita consumir la
    // cuota diaria de Gmail API que comparten todos los usuarios gratis.
    if (isLite) {
      const last = await ComprasDatabase.getLastManualSync(currentCompany.id);
      const remainingMs = ComprasDatabase.msUntilNextLiteSync(last, LITE_SYNC_COOLDOWN_HOURS);
      if (remainingMs > 0) {
        toast.error(
          `Tu plan gratuito permite 1 sincronización cada 24h. Intenta en ${formatRemainingHours(remainingMs)} o actualiza a Pro para sincronizar sin límite.`,
        );
        return;
      }
    }
    setSyncingGmail(true);
    try {
      // Use this company's linked Gmail account (renewing an expired token),
      // or link one now — both may open the Google consent page.
      const linkedAccount = await ComprasDatabase.getLinkedGmail(currentCompany.id);
      let token: string | null;
      let linkedEmail = linkedAccount?.email ?? null;
      if (linkedAccount) {
        token = await getGmailAccessToken(currentCompany.id, { interactive: true });
      } else {
        const linked = await linkGmailAccount(currentCompany.id);
        token = linked.accessToken;
        linkedEmail = linked.email;
      }
      if (!token) {
        toast.error(GMAIL_RECONNECT_MESSAGE);
        return;
      }

      // Primer sync (lista vacía): forzamos 90 días (3m) sin importar el
      // preset seleccionado — garantiza un arranque con datos suficientes.
      const isFirstSync = compras.length === 0;
      const effectiveRange: SyncRangePreset = isFirstSync ? '3m' : syncRange;
      const dateRange = computeSyncRange(effectiveRange);
      const result = await GmailImportService.syncComprasForCompany(
        currentCompany.id,
        token,
        dateRange,
        { autoVerify: true, isProduction: isProductionCompany(currentCompany) },
      );
      const rangeLabel = SYNC_RANGE_LABELS[effectiveRange];
      if (result.authError) {
        toast.error(
          result.errorMessage ?? 'Error de autenticación con Gmail. Vuelve a conectar la cuenta.',
        );
      } else if (result.quotaExceeded) {
        toast.error(
          `${result.errorMessage ?? 'Cuota diaria de Gmail API agotada.'} Considera actualizar a Pro para usar IMAP sin límite de cuota.`,
        );
      } else if (result.errors > 0 && result.imported === 0) {
        toast.error(
          result.errorMessage ??
            `${linkedEmail ?? 'Gmail'} (${rangeLabel}): ${result.errors} errores, nada importado`,
        );
      } else {
        toast.success(
          `${linkedEmail ?? 'Gmail'} (${rangeLabel}): ${result.imported} importadas, ${result.skipped} ignoradas, ${result.errors} errores`,
        );
        warnReceptorMismatch(result.receptorMismatch);
        // Anclamos el cooldown del tier Lite al último sync EXITOSO. Si falla
        // por auth o red, el usuario puede reintentar sin esperar 24h.
        await ComprasDatabase.setLastManualSync(currentCompany.id, new Date().toISOString());
      }
      dispatch(loadCompras(currentCompany.id));
      // Primer sync + se importó algo → re-verificamos todo en batch contra
      // MH Consulta Pública. El autoVerify inline ya corrió durante el
      // import, pero un batch final da una pasada consistente al usuario.
      if (isFirstSync && result.imported > 0 && !result.authError && !result.quotaExceeded) {
        // Reload primero para que handleVerifyAll vea las compras recién
        // importadas en el estado de Redux.
        await dispatch(loadCompras(currentCompany.id));
        await handleVerifyAll();
      }
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Error al sincronizar con Gmail');
    } finally {
      setSyncingGmail(false);
    }
  }

  useEffect(() => {
    if (!dbInitialized) {
      dispatch(initComprasDatabase()).then(() => {
        if (currentCompany) dispatch(loadCompras(currentCompany.id));
      });
    } else if (currentCompany) {
      dispatch(loadCompras(currentCompany.id));
    }
  }, [currentCompany?.id, dbInitialized, dispatch]);

  function handleSearch(val: string) {
    setLocalSearch(val);
    dispatch(setSearchTerm(val));
    if (currentCompany) dispatch(loadCompras(currentCompany.id));
  }

  function handleDateChange(from: string, to: string) {
    dispatch(setDateRange({ from: from || null, to: to || null }));
    if (currentCompany) dispatch(loadCompras(currentCompany.id));
  }

  const visibleCompras = compras.filter((c) =>
    usoFilter === 'all' ? true : usoFilter === 'internal' ? c.internalUse === true : c.internalUse !== true,
  );

  const columns: ColumnDef<CompraRow>[] = [
    { key: 'fecha', label: 'Fecha', sortable: true },
    {
      key: 'emisorLabel',
      label: 'Emisor',
      render: (val) => <span className="text-brand-800">{String(val)}</span>,
    },
    {
      key: 'tipoDte',
      label: 'Tipo DTE',
      render: (val, row) =>
        row.internalUse ? (
          <Badge variant="warning" data-testid={`compra-internal-chip-${row.id}`}>Uso interno</Badge>
        ) : (
          <Badge variant="neutral">{String(val)}</Badge>
        ),
    },
    {
      key: 'totalPagar',
      label: 'Total',
      sortable: true,
      render: (val) => (
        <span className="font-medium">${Number(val).toFixed(2)}</span>
      ),
    },
    {
      key: 'source',
      label: 'Fuente',
      render: (val) => {
        const src = val as CompraSource;
        return <Badge variant={SOURCE_VARIANTS[src]}>{SOURCE_LABELS[src]}</Badge>;
      },
    },
    {
      key: 'verified',
      label: 'Verificado',
      render: (val, row) =>
        row.internalUse ? (
          <Badge variant="neutral">No aplica</Badge>
        ) : val === true ? (
          <Badge variant="success">Verificado</Badge>
        ) : val === false ? (
          <Badge variant="error">Inválido</Badge>
        ) : (
          <Badge variant="neutral">Sin verificar</Badge>
        ),
    },
    {
      key: 'linked',
      label: 'Vinculada',
      render: (_, row) =>
        row.linked ? (
          <Badge variant="info" data-testid={`compra-linked-chip-${row.id}`}>Vinculada</Badge>
        ) : (
          <span className="text-brand-300">—</span>
        ),
    },
  ];

  return (
    <div data-testid="compras-list" className="space-y-4">
      <PageHeader
        title="Compras"
        subtitle="Registro de compras y gastos"
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-brand-600">
              <span>Rango:</span>
              <select
                className="rounded-md border border-brand-200 bg-white px-2 py-1 text-xs"
                value={syncRange}
                onChange={(e) => setSyncRange(e.target.value as SyncRangePreset)}
                disabled={syncingGmail}
                data-testid="compras-sync-range"
              >
                {(Object.keys(SYNC_RANGE_LABELS) as SyncRangePreset[]).map((key) => (
                  <option key={key} value={key}>{SYNC_RANGE_LABELS[key]}</option>
                ))}
              </select>
            </label>
            {/* Botón principal: resuelve la fuente PREFERIDA (IMAP si está
                configurado, Gmail como respaldo) — ver handleSyncPreferred.
                Se mantiene separado de "compras-sync-gmail" (abajo), que
                sigue siendo el flujo específico de conectar/sincronizar
                Gmail, para no romper su comportamiento existente. */}
            <Button
              variant="primary"
              icon={
                isSyncing ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )
              }
              onClick={handleSyncPreferred}
              disabled={isSyncing || !currentCompany}
              loading={isSyncing}
              data-testid="compras-sync-button"
              title="Sincroniza compras por IMAP (si está configurado) o Gmail"
            >
              Sincronizar
            </Button>
            <Button
              variant="secondary"
              icon={
                syncingGmail ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Mail size={16} />
                )
              }
              onClick={handleGmailSync}
              disabled={syncingGmail || !currentCompany}
              loading={syncingGmail}
              data-testid="compras-sync-gmail"
            >
              {linkedGmailEmail ? 'Sincronizar Gmail' : 'Conectar y sincronizar Gmail'}
            </Button>
            <Button
              variant="secondary"
              icon={<ImageIcon size={16} />}
              onClick={() => setShowImageImport(true)}
              disabled={!currentCompany}
              data-testid="compras-import-images"
              title="Importa facturas desde imágenes (OCR), PDFs o XML (Costa Rica v4.4)"
            >
              Importar archivos
            </Button>
            <Button
              variant="ghost"
              icon={<Settings size={16} />}
              onClick={() => navigate('/compras/settings')}
              aria-label="Configuración de compras"
            />
            <Button
              variant="secondary"
              icon={
                verifyingAll ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <ShieldCheck size={16} />
                )
              }
              onClick={handleVerifyAll}
              disabled={verifyingAll || !currentCompany || compras.length === 0}
              loading={verifyingAll}
              data-testid="compras-verify-all"
              title="Verifica cada compra contra la Consulta Pública del Ministerio de Hacienda"
            >
              {verifyingAll && verifyProgress
                ? `Verificando ${verifyProgress.current}/${verifyProgress.total}`
                : 'Verificar compras'}
            </Button>
            {/* Botón "Reconectar Gmail" — solo se muestra cuando YA hay una
                cuenta vinculada. Fuerza un re-auth con Google (útil cuando
                el token está caducado y el sync devuelve 401). Para el
                primer enlace, el botón "Conectar y sincronizar Gmail" de
                la izquierda ya se encarga de autenticar + sincronizar. */}
            {linkedGmailEmail && (
            <button
              type="button"
              onClick={handleReconnectGmail}
              disabled={connectingGmail || !currentCompany}
              data-testid="compras-reconnect-gmail"
              className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Fuerza un nuevo inicio de sesión con Google si el sync devuelve 401"
            >
              {connectingGmail ? (
                <RefreshCw size={16} className="animate-spin text-red-600" />
              ) : (
                // Gmail brand mark (red/white envelope) — inline SVG avoids
                // multi-component Fast Refresh issues.
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width={16}
                  height={16}
                  viewBox="0 0 48 48"
                  aria-hidden="true"
                >
                  <path fill="#4285f4" d="M24 22.75 44 10v27a3 3 0 0 1-3 3H31V24.75Z" />
                  <path fill="#34a853" d="M7 40a3 3 0 0 1-3-3V10l20 12.75V40Z" />
                  <path fill="#ea4335" d="M4 10a3 3 0 0 1 3-3h2l15 9.5L39 7h2a3 3 0 0 1 3 3l-20 12.75Z" />
                </svg>
              )}
              Reconectar Gmail
            </button>
            )}
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              onClick={() => navigate('/compras/add')}
            >
              Agregar Compra
            </Button>
          </div>
        }
      />

      {linkedGmailEmail && (
        <p className="text-xs text-brand-500">
          Gmail vinculado: <span className="font-medium">{linkedGmailEmail}</span>
        </p>
      )}

      {/* Sync progress banners — driven by the syncComprasNow thunk
          (IMAP-preferred, Gmail fallback). Indeterminate spinner while the
          fetch is in flight (total unknown); determinate bar once total>0.
          Mirrors PurchasesView.swift's sidebarView progress section. */}
      {isSyncing && (
        <div
          data-testid="compras.syncingBanner"
          className="flex flex-col gap-2 rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-700"
        >
          <div className="flex items-center gap-2">
            <RefreshCw size={14} className="animate-spin" />
            <span data-testid="compras.syncProgressLabel">
              {syncProgress && syncProgress.total > 0
                ? `Sincronizando… ${syncProgress.current} de ${syncProgress.total}`
                : 'Sincronizando compras…'}
            </span>
          </div>
          {syncProgress && syncProgress.total > 0 && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
              <div
                data-testid="compras.syncProgressBar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(safeProgressFraction(syncProgress.current, syncProgress.total) * 100)}
                className="h-full rounded-full bg-blue-500 transition-all duration-200"
                style={{ width: `${safeProgressFraction(syncProgress.current, syncProgress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {isVerifyingImap && (
        <div
          data-testid="compras.verifyingBanner"
          className="flex flex-col gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-700"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} />
            <span>
              Verificando con Hacienda… {imapVerifyProgress?.current ?? 0} de {imapVerifyProgress?.total ?? 0}
            </span>
          </div>
          {imapVerifyProgress && imapVerifyProgress.total > 0 && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-sky-100">
              <div
                data-testid="compras.verifyProgressBar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(safeProgressFraction(imapVerifyProgress.current, imapVerifyProgress.total) * 100)}
                className="h-full rounded-full bg-sky-500 transition-all duration-200"
                style={{ width: `${safeProgressFraction(imapVerifyProgress.current, imapVerifyProgress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {!isSyncing && newPurchasesCount > 0 && (
        <div
          data-testid="compras.newPurchasesNotice"
          className="flex items-center gap-2 rounded-md border border-green-100 bg-green-50 p-3 text-sm text-green-700"
        >
          <Sparkles size={14} />
          <span>{newPurchasesCount} nuevas facturas importadas</span>
        </div>
      )}

      {syncError && (
        <div
          data-testid="compras.syncError"
          className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700"
        >
          {syncError}
        </div>
      )}

      {/* Monthly summary */}
      {monthlyTotal && (
        <Card className="bg-brand-50">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <p className="text-brand-400">Compras este mes</p>
              <p className="text-2xl font-bold text-brand-900">{monthlyTotal.count}</p>
            </div>
            <div>
              <p className="text-brand-400">Total Gravado</p>
              <p className="text-2xl font-bold text-brand-900">${monthlyTotal.totalGravada.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-brand-400">Total IVA</p>
              <p className="text-2xl font-bold text-brand-900">${monthlyTotal.totalIva.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-brand-400">Total a Pagar</p>
              <p className="text-2xl font-bold text-accent-600">${monthlyTotal.totalPagar.toFixed(2)}</p>
            </div>
          </div>
        </Card>
      )}

      <StickyToolbar data-testid="compras-sticky-toolbar">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <SearchBar
              value={localSearch}
              onChange={handleSearch}
              placeholder="Buscar por NIT, nombre..."
            />
          </div>
          <Input
            label="Fecha desde"
            type="date"
            value={dateFrom ?? ''}
            onChange={(e) => handleDateChange(e.target.value, dateTo ?? '')}
            className="w-40"
          />
          <Input
            label="Fecha hasta"
            type="date"
            value={dateTo ?? ''}
            onChange={(e) => handleDateChange(dateFrom ?? '', e.target.value)}
            className="w-40"
          />
          <div className="w-44">
            <label className="block text-sm font-medium text-brand-700 mb-1" htmlFor="compras-uso-filter">
              Tipo de registro
            </label>
            <select
              id="compras-uso-filter"
              data-testid="compras-uso-filter"
              value={usoFilter}
              onChange={(e) => setUsoFilter(e.target.value as 'all' | 'internal' | 'dte')}
              className="w-full rounded-lg border border-brand-300 bg-white px-3 py-2 text-sm text-brand-800"
            >
              <option value="all">Todas</option>
              <option value="dte">Solo DTE</option>
              <option value="internal">Solo uso interno</option>
            </select>
          </div>
        </div>

      </StickyToolbar>

      {compras.length === 0 && !loading && !syncingGmail && !verifyingAll && !isSyncing && !isVerifyingImap ? (
        <EmptyState
          icon={<ShoppingBag size={28} />}
          title="No hay compras registradas"
          message="Agrega una compra manualmente o importa un JSON DTE."
          action={{ label: 'Agregar Compra', onClick: () => navigate('/compras/add') }}
        />
      ) : (
        <DataTable<CompraRow>
          columns={columns}
          data={visibleCompras.map(toRow)}
          // Muestra el spinner del DataTable también durante sync y verify
          // batch — así el usuario ve que la tabla está en progreso aunque
          // el disparador haya sido un botón fuera del panel.
          loading={loading || syncingGmail || verifyingAll || isSyncing || isVerifyingImap}
          onRowClick={(row) => navigate(`/compras/${row.id}`)}
          emptyMessage="No hay compras que coincidan con los filtros."
        />
      )}

      {currentCompany && (
        <ImportFromImageModal
          isOpen={showImageImport}
          onClose={() => setShowImageImport(false)}
          companyId={currentCompany.id}
          onImported={() => {
            // Reload the list so the new OCR-imported rows show up.
            dispatch(loadCompras(currentCompany.id));
          }}
        />
      )}
    </div>
  );
}
