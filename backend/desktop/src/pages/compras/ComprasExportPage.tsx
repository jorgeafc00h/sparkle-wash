import { useState } from 'react';
import { Download, Cloud } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { useToast } from '@/components/common/Toast';
import { useAppSelector } from '@/store';
import { selectCurrentCompany } from '@/store';
import { ComprasExportService } from '@/services/compras/ComprasExportService';
import GoogleDriveExportService from '@/services/export/GoogleDriveExportService';
import GoogleAuthService from '@/services/auth/GoogleAuthService';
import { isInternalUseCompra } from '@/types/compras';

const FORMAT_OPTIONS = [
  { value: 'csv', label: 'CSV' },
  { value: 'excel', label: 'Excel (.xlsx)' },
];

export default function ComprasExportPage() {
  const toast = useToast();
  const currentCompany = useAppSelector(selectCurrentCompany);
  const { compras } = useAppSelector((s) => s.compras);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [format, setFormat] = useState('csv');
  const [includeInternal, setIncludeInternal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sendingToDrive, setSendingToDrive] = useState(false);

  // Uso interno nunca va en el CSV (carga a MH). Solo el Excel general puede
  // incluirlas, y solo si el usuario lo pide.
  const internalAllowed = includeInternal && format === 'excel';

  function inRange(c: (typeof compras)[number]) {
    if (dateFrom && c.fecha < dateFrom) return false;
    if (dateTo && c.fecha > dateTo) return false;
    return true;
  }

  function applyFilters() {
    return compras.filter((c) => inRange(c) && (internalAllowed || !isInternalUseCompra(c)));
  }

  const internalCount = compras.filter((c) => inRange(c) && isInternalUseCompra(c)).length;
  const totalInternal = compras.filter(isInternalUseCompra).length;
  const exportableTotal = internalAllowed ? compras.length : compras.length - totalInternal;
  const filteredCount = applyFilters().length;

  async function handleExport() {
    if (!currentCompany) {
      toast.error('No hay empresa seleccionada.');
      return;
    }
    setExporting(true);
    try {
      const filtered = applyFilters();
      if (filtered.length === 0) {
        toast.warning('No hay compras en el rango de fechas seleccionado.');
        return;
      }

      if (format === 'csv') {
        const { blob, fileName } = ComprasExportService.buildCsvBlob(filtered, dateFrom, dateTo);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        toast.success(`${filtered.length} compras exportadas como CSV.`);
      } else {
        await ComprasExportService.exportToExcel(filtered, currentCompany.nombre ?? 'empresa', {
          includeInternal: internalAllowed,
        });
        toast.success(`${filtered.length} compras exportadas como Excel.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al exportar.');
    } finally {
      setExporting(false);
    }
  }

  async function handleSendToDrive() {
    if (!currentCompany) {
      toast.error('No hay empresa seleccionada.');
      return;
    }
    if (!(await GoogleAuthService.isSignedIn())) {
      toast.error('Conecta tu cuenta de Google en Configuración para subir a Drive.');
      return;
    }
    const filtered = applyFilters();
    if (filtered.length === 0) {
      toast.warning('No hay compras en el rango de fechas seleccionado.');
      return;
    }
    setSendingToDrive(true);
    try {
      const { blob, fileName } =
        format === 'csv'
          ? ComprasExportService.buildCsvBlob(filtered, dateFrom, dateTo)
          : ComprasExportService.buildExcelBlob(filtered, currentCompany.nombre ?? 'empresa', {
              includeInternal: internalAllowed,
            });

      const rootFolder = await GoogleDriveExportService.ensureFolder('SparkleWash');
      const folder = await GoogleDriveExportService.ensureFolder('Compras', rootFolder);
      await GoogleDriveExportService.uploadFile({
        content: blob,
        fileName,
        mimeType: blob.type,
        folderId: folder,
        description: `Compras ${dateFrom || 'inicio'}–${dateTo || 'fin'}`,
      });
      toast.success(`Subido a Google Drive: ${fileName}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al subir a Drive.');
    } finally {
      setSendingToDrive(false);
    }
  }

  return (
    <div data-testid="compras-export" className="max-w-lg mx-auto space-y-6">
      <PageHeader
        title="Exportar Compras"
        subtitle="Exportación de registros de compras"
      />

      <Card className="space-y-4">
        <h2 className="font-semibold text-brand-800">Filtros de Exportación</h2>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Fecha desde"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <Input
            label="Fecha hasta"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <Select
          label="Formato de exportación"
          options={FORMAT_OPTIONS}
          value={format}
          onChange={(e) => setFormat(e.target.value)}
        />
        <p className="text-sm text-brand-500">
          {filteredCount === exportableTotal
            ? `Se exportarán todas las ${exportableTotal} compras.`
            : `Se exportarán ${filteredCount} de ${exportableTotal} compras con los filtros actuales.`}
        </p>
        {totalInternal > 0 && (
          <div className="space-y-2" data-testid="compras-export-internal">
            {!internalAllowed && (
              <p
                data-testid="compras-export-internal-excluded"
                className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
              >
                {internalCount} {internalCount === 1 ? 'compra de uso interno excluida' : 'compras de uso interno excluidas'}
                {' '}(no se envían a Hacienda).
              </p>
            )}
            <label className="flex items-start gap-2 text-sm text-brand-700">
              <input
                type="checkbox"
                data-testid="compras-export-include-internal"
                checked={includeInternal}
                disabled={format !== 'excel'}
                onChange={(e) => setIncludeInternal(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Incluir compras de uso interno (solo Excel de control general; el CSV
                para Hacienda nunca las incluye).
              </span>
            </label>
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="primary"
            icon={<Download size={16} />}
            onClick={handleExport}
            loading={exporting}
            disabled={compras.length === 0}
            className="flex-1"
          >
            Descargar
          </Button>
          <Button
            variant="secondary"
            icon={<Cloud size={16} />}
            onClick={handleSendToDrive}
            loading={sendingToDrive}
            disabled={compras.length === 0}
            className="flex-1"
          >
            Enviar a Drive
          </Button>
        </div>
      </Card>
    </div>
  );
}
