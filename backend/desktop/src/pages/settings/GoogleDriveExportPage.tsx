import { useState, useEffect, useCallback } from 'react';
import { CloudUpload, Download, RefreshCw, HardDrive } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useAppSelector } from '@/store';
import { selectCurrentTier } from '@/store';
import { selectIsAuthenticated, selectCurrentUser } from '@/store';
import { FreeTrialOffer } from '@/components/modals/FreeTrialOffer';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { canUploadToDrive } from '@/services/subscription/FeatureGate';
import GoogleDriveExportService, { DriveFile, BackupData } from '@/services/export/GoogleDriveExportService';
import GoogleAuthService from '@/services/auth/GoogleAuthService';
import { selectAllInvoices } from '@/store/selectors/invoiceSelectors';
import { selectAllCustomers } from '@/store/selectors/customerSelectors';
import { selectAllProducts } from '@/store/selectors/productSelectors';
import { selectAllCompanies } from '@/store/selectors/companySelectors';

// ── Component ─────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-SV', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function GoogleDriveExportPage() {
  const tier = useAppSelector(selectCurrentTier);
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const currentUser = useAppSelector(selectCurrentUser);

  const invoices = useAppSelector(selectAllInvoices);
  const customers = useAppSelector(selectAllCustomers);
  const products = useAppSelector(selectAllProducts);
  const companies = useAppSelector(selectAllCompanies);

  const [backups, setBackups] = useState<DriveFile[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ fileId: string; webViewLink: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastExportDate, setLastExportDate] = useState<string | null>(null);

  const isPaidTier = canUploadToDrive(tier);
  const [isSignedInWithGoogle, setIsSignedInWithGoogle] = useState(false);
  const canExport = isPaidTier && isSignedInWithGoogle;

  useEffect(() => {
    GoogleAuthService.isSignedIn().then(setIsSignedInWithGoogle);
  }, []);

  const loadBackups = useCallback(async () => {
    if (!canExport) return;
    setLoadingBackups(true);
    setError(null);
    try {
      const files = await GoogleDriveExportService.listBackups();
      setBackups(files);
      if (files.length > 0) {
        setLastExportDate(files[0].createdTime);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar respaldos de Google Drive');
    } finally {
      setLoadingBackups(false);
    }
  }, [canExport]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  async function handleExport() {
    setExporting(true);
    setError(null);
    setExportResult(null);
    try {
      const backupData: BackupData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        companies,
        customers,
        products,
        invoices,
      };
      const result = await GoogleDriveExportService.exportBackup(backupData);
      setExportResult(result);
      setLastExportDate(new Date().toISOString());
      await loadBackups();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al exportar a Google Drive');
    } finally {
      setExporting(false);
    }
  }

  async function handleDownload(fileId: string, fileName: string) {
    try {
      const data = await GoogleDriveExportService.downloadBackup(fileId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al descargar respaldo');
    }
  }

  // ── Locked state: free tier ───────────────────────────────────────────
  if (!isPaidTier) {
    return (
      <div data-testid="google-drive-export" className="space-y-6">
        <PageHeader
          title="Exportar a Google Drive"
          subtitle="Respaldo automático en la nube"
        />
        <Card>
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-purple-100 flex items-center justify-center mb-4">
              <HardDrive size={32} className="text-purple-600" />
            </div>
            <h2 className="text-xl font-bold text-brand-800 mb-2">Función Pro</h2>
            <p className="text-brand-500 text-sm max-w-xs">
              La exportación a Google Drive requiere una suscripción Pro.
              Actualiza tu plan desde la sección Cuenta.
            </p>
            <FreeTrialOffer className="mt-5" />
          </div>
        </Card>
      </div>
    );
  }

  // ── Locked state: not signed in with Google ───────────────────────────
  if (!isSignedInWithGoogle) {
    return (
      <div data-testid="google-drive-export" className="space-y-6">
        <PageHeader
          title="Exportar a Google Drive"
          subtitle="Respaldo automático en la nube"
        />
        <Card>
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center mb-4">
              <HardDrive size={32} className="text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-brand-800 mb-2">Inicia sesión con Google</h2>
            <p className="text-brand-500 text-sm max-w-xs">
              Para usar el respaldo en Google Drive necesitas iniciar sesión con tu cuenta de Google.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────
  return (
    <div data-testid="google-drive-export" className="space-y-6">
      <PageHeader
        title="Exportar a Google Drive"
        subtitle={currentUser ? `Cuenta: ${currentUser.email}` : 'Respaldo automático en la nube'}
      />

      {/* Export card */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <CloudUpload size={24} className="text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-brand-800 mb-1">Crear Respaldo</h2>
            <p className="text-sm text-brand-500 mb-1">
              Exporta todas tus facturas, clientes, productos y empresas a Google Drive.
            </p>
            {lastExportDate && (
              <p className="text-xs text-brand-400">
                Último respaldo: {formatDate(lastExportDate)}
              </p>
            )}
          </div>
          <Button
            variant="primary"
            icon={<CloudUpload size={16} />}
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? 'Exportando...' : 'Crear Respaldo'}
          </Button>
        </div>

        {/* Progress/result feedback */}
        {exporting && (
          <div className="mt-4 flex items-center gap-2 text-sm text-brand-600">
            <LoadingSpinner size="sm" />
            <span>Subiendo datos a Google Drive...</span>
          </div>
        )}

        {exportResult && !exporting && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-green-700 text-sm font-medium">Respaldo creado exitosamente.</p>
            {exportResult.webViewLink && (
              <a
                href={exportResult.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-600 text-xs underline mt-1 block"
              >
                Ver en Google Drive
              </a>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}
      </Card>

      {/* Backup list */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-brand-800">Respaldos Existentes</h2>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={loadBackups}
            disabled={loadingBackups}
          >
            Actualizar
          </Button>
        </div>

        {loadingBackups ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : backups.length === 0 ? (
          <p className="text-sm text-brand-400 text-center py-8">
            No hay respaldos en Google Drive aún.
          </p>
        ) : (
          <div className="space-y-2">
            {backups.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between p-3 bg-brand-50 rounded-lg border border-brand-100"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-800 truncate">{file.name}</p>
                  <p className="text-xs text-brand-400">{formatDate(file.createdTime)}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download size={14} />}
                  onClick={() => handleDownload(file.id, file.name)}
                >
                  Descargar
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
