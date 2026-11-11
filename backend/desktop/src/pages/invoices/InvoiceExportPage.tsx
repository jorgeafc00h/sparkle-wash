import React, { useState, useMemo } from 'react';
import { Download, FileText, Cloud, File } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Select } from '@/components/common/Select';
import { DatePicker } from '@/components/forms/DatePicker';
import { SubscriptionModal } from '@/components/modals/SubscriptionModal';
import { useToast } from '@/components/common/Toast';
import { useAppSelector } from '@/store';
import { selectAllInvoices } from '@/store/selectors/invoiceSelectors';
import { selectAllCustomers } from '@/store/selectors/customerSelectors';
import {
  currentSVYearMonth,
  firstOfMonthSV,
  formatSVDateDisplay,
  isWithinSVDateRange,
  svYearMonthOf,
  todaySV,
} from '@/utils/svDate';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { selectCurrentTier } from '@/store';
import { canExport, canBatchExportPDF, canUploadToDrive } from '@/services/subscription/FeatureGate';
import { InvoiceType, InvoiceStatus } from '@/types/invoice';
import { InvoiceExcelExportService } from '@/services/export/InvoiceExcelExportService';
import { InvoicePDFGenerator } from '@/services/pdf/InvoicePDFGenerator';
import GoogleDriveExportService from '@/services/export/GoogleDriveExportService';
import GoogleAuthService from '@/services/auth/GoogleAuthService';

const TYPE_OPTIONS = [
  { label: 'Todos los tipos', value: '' },
  { label: 'Factura', value: String(InvoiceType.Factura) },
  { label: 'CCF', value: String(InvoiceType.CCF) },
  { label: 'Nota de Crédito', value: String(InvoiceType.NotaCredito) },
  { label: 'Sujeto Excluido', value: String(InvoiceType.SujetoExcluido) },
  { label: 'Nota de Débito', value: String(InvoiceType.NotaDebito) },
  { label: 'Nota de Remisión', value: String(InvoiceType.NotaRemision) },
  { label: 'Comp. Liquidación', value: String(InvoiceType.ComprobanteLiquidacion) },
  { label: 'Factura Exportación', value: String(InvoiceType.FacturaExportacion) },
  { label: 'Comp. Retención', value: String(InvoiceType.ComprobanteRetencion) },
  { label: 'Doc. Contable Liq.', value: String(InvoiceType.DocumentoContableLiquidacion) },
  { label: 'Comp. Donación', value: String(InvoiceType.ComprobanteDonacion) },
  { label: 'Evento Operaciones Especiales (17)', value: String(InvoiceType.EventoOperacionesEspeciales) },
  { label: 'Evento de Retorno (18)', value: String(InvoiceType.EventoRetorno) },
];

const STATUS_OPTIONS = [
  { label: 'Todos los estados', value: '' },
  { label: 'Nueva', value: String(InvoiceStatus.Nueva) },
  { label: 'Completada', value: String(InvoiceStatus.Completada) },
  { label: 'Anulada', value: String(InvoiceStatus.Anulada) },
  { label: 'Error envío', value: String(InvoiceStatus.ErrorEnvio) },
];

const FORMAT_OPTIONS = [
  { label: 'Excel (.xlsx)', value: 'excel' },
  { label: 'JSON — plan de pago', value: 'json' },
  { label: 'PDF (individual) — plan de pago', value: 'pdf' },
];

export default function InvoiceExportPage() {
  const toast = useToast();
  const allInvoices = useAppSelector(selectAllInvoices);
  const allCustomers = useAppSelector(selectAllCustomers);
  const company = useAppSelector(selectCurrentCompany);
  const tier = useAppSelector(selectCurrentTier);
  // Export the selected company only — the store holds every company's
  // documents (including a production company's TEST clone).
  const companyId = company?.id;
  const invoices = useMemo(
    () => (companyId ? allInvoices.filter(inv => inv.companyId === companyId) : []),
    [allInvoices, companyId],
  );
  const customers = useMemo(
    () => (companyId ? allCustomers.filter(c => c.companyId === companyId) : allCustomers),
    [allCustomers, companyId],
  );

  // El Salvador calendar dates (the UTC date is "tomorrow" from 18:00 SV).
  const today = todaySV();
  const firstOfMonth = firstOfMonthSV();

  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [format, setFormat] = useState('excel');
  const [exporting, setExporting] = useState(false);
  const [sendingToDrive, setSendingToDrive] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Tier gates — Excel is free for everyone; JSON export, batch PDF export and
  // the Drive upload are paid features (see FeatureGate + subscriptionConfig).
  const jsonAllowed = canExport(tier);
  const pdfAllowed = canBatchExportPDF(tier);
  const driveAllowed = canUploadToDrive(tier);
  const requireUpgrade = (message: string) => {
    toast.info(`${message} Disponible en los planes Pro y Business.`);
    setShowUpgrade(true);
  };

  const filtered = useMemo(() => {
    // Compare SV calendar dates: `new Date(isoTimestamp + 'T00:00:00')` was an
    // Invalid Date, so POS-consolidated invoices (ISO dates) silently dropped out.
    let result = invoices.filter(inv => isWithinSVDateRange(inv.date, dateFrom || undefined, dateTo || undefined));
    if (typeFilter !== '') result = result.filter(inv => inv.invoiceType === parseInt(typeFilter));
    if (statusFilter !== '') result = result.filter(inv => inv.status === parseInt(statusFilter));
    return result;
  }, [invoices, dateFrom, dateTo, typeFilter, statusFilter]);

  async function handleExport() {
    if (filtered.length === 0) {
      toast.warning('No hay DTE o eventos que cumplan los filtros seleccionados.');
      return;
    }
    if (format === 'json' && !jsonAllowed) {
      requireUpgrade('La exportación JSON es un plan de pago.');
      return;
    }
    if (format === 'pdf' && !pdfAllowed) {
      requireUpgrade('La exportación PDF por lote es un plan de pago.');
      return;
    }
    setExporting(true);
    try {
      const nit = company?.nit || 'empresa';
      // File period = SV year+month of the first document; the documents are
      // exactly the filtered selection (prefiltered — the range may span months).
      const { year, month } = svYearMonthOf(filtered[0].date) ?? currentSVYearMonth();

      if (format === 'excel') {
        await InvoiceExcelExportService.exportMonthlyInvoices(
          filtered, customers, nit, year, month, { prefiltered: true }
        );
        toast.success(`${filtered.length} DTE/eventos exportados a Excel.`);
      } else if (format === 'json') {
        await InvoiceExcelExportService.exportMonthlyInvoicesJSON(
          filtered, customers, nit, year, month, { prefiltered: true }
        );
        toast.success(`${filtered.length} DTE/eventos exportados a JSON.`);
      } else if (format === 'pdf') {
        if (!company) {
          toast.error('Selecciona una empresa antes de exportar PDFs.');
          return;
        }
        // Export each invoice as individual PDF — one summary toast at the
        // end instead of one per invoice (a monthly batch can be 100+).
        let saved = 0;
        let failed = 0;
        for (const invoice of filtered) {
          const ok = await InvoicePDFGenerator.generateAndSavePDF(invoice, company, { watermark: false });
          if (ok) saved += 1;
          else failed += 1;
        }
        if (failed > 0) {
          toast.warning(`${saved} PDF exportados, ${failed} con error.`);
        } else {
          toast.success(`${saved} PDF exportados.`);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al exportar.');
    } finally {
      setExporting(false);
    }
  }

  async function handleSendToDrive() {
    if (filtered.length === 0) {
      toast.warning('No hay DTE o eventos que cumplan los filtros seleccionados.');
      return;
    }
    if (!driveAllowed) {
      requireUpgrade('La subida a Google Drive es un plan de pago.');
      return;
    }
    if (!(await GoogleAuthService.isSignedIn())) {
      toast.error('Conecta tu cuenta de Google en Configuración para subir a Drive.');
      return;
    }
    setSendingToDrive(true);
    try {
      const nit = company?.nit || 'empresa';
      const { year, month } = svYearMonthOf(filtered[0].date) ?? currentSVYearMonth();
      const period = `${year}-${String(month).padStart(2, '0')}`;

      const { blob, fileName } =
        format === 'excel'
          ? InvoiceExcelExportService.buildMonthlyInvoicesBlob(filtered, customers, nit, year, month, { prefiltered: true })
          : InvoiceExcelExportService.buildMonthlyInvoicesJSONBlob(filtered, customers, nit, year, month, { prefiltered: true });

      const rootFolder = await GoogleDriveExportService.ensureFolder('SparkleWash');
      const folder = await GoogleDriveExportService.ensureFolder(`DTE_Eventos_${period}`, rootFolder);
      await GoogleDriveExportService.uploadFile({
        content: blob,
        fileName,
        mimeType: blob.type,
        folderId: folder,
        description: `DTE y eventos ${period}`,
      });
      toast.success(`Subido a Google Drive: ${fileName}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al subir a Drive.');
    } finally {
      setSendingToDrive(false);
    }
  }

  return (
    <div data-testid="invoice-export" className="space-y-6">
      <PageHeader
        title="Exportar DTE y Eventos"
        subtitle="Descarga documentos tributarios electrónicos y eventos en Excel, JSON o PDF"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-brand-800">Filtros</h2>
              {dateFrom !== firstOfMonth && (
                <span className="text-xs text-brand-500">
                  📅 Periodo: {formatSVDateDisplay(dateFrom)} - {formatSVDateDisplay(dateTo)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DatePicker label="Desde" value={dateFrom} onChange={setDateFrom} />
              <DatePicker label="Hasta" value={dateTo} onChange={setDateTo} />
              <Select
                label="Tipo de documento"
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                options={TYPE_OPTIONS}
              />
              <Select
                label="Estado"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                options={STATUS_OPTIONS}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-3">Resumen</h2>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-brand-50">
              <FileText size={20} className="text-accent-600" />
              <div>
                <p className="text-2xl font-bold text-brand-900">{filtered.length}</p>
                <p className="text-xs text-brand-500">
                  {filtered.length === 1 ? 'DTE/evento encontrado' : 'DTE/eventos encontrados'}
                </p>
              </div>
            </div>
            {filtered.length > 0 && (
              <p className="text-xs text-brand-400 mt-2">
                Total: ${filtered.reduce((s, inv) =>
                  s + (inv.totals?.totalPagar ?? inv.totalAmountIncludingTax ?? inv.totalAmount ?? 0), 0
                ).toFixed(2)}
              </p>
            )}
          </Card>

          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-3">Formato</h2>
            <Select
              value={format}
              onChange={e => setFormat(e.target.value)}
              options={FORMAT_OPTIONS}
            />
          </Card>

          <Button
            variant="primary"
            size="lg"
            icon={<Download size={16} />}
            loading={exporting}
            onClick={handleExport}
            className="w-full"
            disabled={filtered.length === 0}
          >
            Descargar {filtered.length > 0 ? `(${filtered.length})` : ''}
          </Button>

          <Button
            variant="secondary"
            size="lg"
            icon={<Cloud size={16} />}
            loading={sendingToDrive}
            onClick={handleSendToDrive}
            className="w-full"
            disabled={filtered.length === 0}
            data-testid="btn-send-to-drive"
          >
            Enviar a Google Drive{driveAllowed ? '' : ' — plan de pago'}
          </Button>
        </div>
      </div>

      <SubscriptionModal isOpen={showUpgrade} onClose={() => setShowUpgrade(false)} />
    </div>
  );
}
