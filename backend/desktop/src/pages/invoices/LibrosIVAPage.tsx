import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCan } from '@/hooks/useLocalUsers';
import { Download, BookOpen, Cloud, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Select } from '@/components/common/Select';
import { useToast } from '@/components/common/Toast';
import { useAppSelector } from '@/store';
import { selectAllInvoices } from '@/store/selectors/invoiceSelectors';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { selectAllCustomers } from '@/store/selectors/customerSelectors';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import { FreeTrialOffer } from '@/components/modals/FreeTrialOffer';
import { canUseLibrosIVA } from '@/services/subscription/FeatureGate';
import { InvoiceType, InvoiceStatus } from '@/types/invoice';
import { MHAnnexExportService } from '@/services/export/MHAnnexExportService';
import GoogleDriveExportService from '@/services/export/GoogleDriveExportService';
import GoogleAuthService from '@/services/auth/GoogleAuthService';
import { TicketDatabase } from '@/services/tickets/TicketDatabase';
import { ComprasDatabase } from '@/services/compras/ComprasDatabase';
import type { Compra } from '@/types/compras';
import { currentSVYearMonth, isInSVMonth, svInstant } from '@/utils/svDate';

const MONTHS = [
  { label: 'Enero', value: '1' },
  { label: 'Febrero', value: '2' },
  { label: 'Marzo', value: '3' },
  { label: 'Abril', value: '4' },
  { label: 'Mayo', value: '5' },
  { label: 'Junio', value: '6' },
  { label: 'Julio', value: '7' },
  { label: 'Agosto', value: '8' },
  { label: 'Septiembre', value: '9' },
  { label: 'Octubre', value: '10' },
  { label: 'Noviembre', value: '11' },
  { label: 'Diciembre', value: '12' },
];
const DTE_EVENT_INVOICE_TYPES = new Set<InvoiceType>([
  InvoiceType.EventoOperacionesEspeciales,
  InvoiceType.EventoRetorno,
]);

function getYearOptions(): { label: string; value: string }[] {
  const current = currentSVYearMonth().year;
  return [current, current - 1, current - 2].map(y => ({ label: String(y), value: String(y) }));
}

function typeName(type: InvoiceType): string {
  switch (type) {
    case InvoiceType.Factura: return 'Factura CF (01)';
    case InvoiceType.CCF: return 'CCF (03)';
    case InvoiceType.NotaCredito: return 'Nota Crédito (05)';
    case InvoiceType.NotaDebito: return 'Nota Débito (06)';
    case InvoiceType.SujetoExcluido: return 'Sujeto Excluido (14)';
    case InvoiceType.FacturaExportacion: return 'Exportación (11)';
    case InvoiceType.ComprobanteRetencion: return 'Retención (07)';
    case InvoiceType.ComprobanteLiquidacion: return 'Liquidación (08)';
    case InvoiceType.DocumentoContableLiquidacion: return 'Doc. Contable (09)';
    case InvoiceType.ComprobanteDonacion: return 'Donación (15)';
    case InvoiceType.EventoOperacionesEspeciales: return 'Evento Op. Especiales (17)';
    case InvoiceType.EventoRetorno: return 'Evento Retorno (18)';
    default: return `Tipo ${type}`;
  }
}

export default function LibrosIVAPage() {
  const navigate = useNavigate();
  const canConsolidate = useCan('pos.consolidate');
  const toast = useToast();
  const tier = useAppSelector(selectCurrentTier);
  const allInvoices = useAppSelector(selectAllInvoices);
  const allCustomers = useAppSelector(selectAllCustomers);
  const company = useAppSelector(selectCurrentCompany);
  const companyId = company?.id;
  // A production company's F-07 must never include its TEST clone's
  // homologation documents (or any other company's): scope everything to the
  // company being declared.
  const invoices = useMemo(
    () => (companyId ? allInvoices.filter(inv => inv.companyId === companyId) : []),
    [allInvoices, companyId],
  );
  const customers = useMemo(
    () => (companyId ? allCustomers.filter(c => c.companyId === companyId) : []),
    [allCustomers, companyId],
  );

  // The Libro de Compras reads this company's FULL purchase ledger straight
  // from ComprasDatabase. `state.compras.compras` is the Compras page's
  // search/date-filtered view — possibly of another company, or empty when
  // the app starts on this page.
  const [compras, setCompras] = useState<Compra[]>([]);
  useEffect(() => {
    if (!companyId) {
      setCompras([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      ComprasDatabase.init()
        .then(() => ComprasDatabase.getCompras({ companyId }))
        .then((ledger) => {
          if (!cancelled) setCompras(ledger);
        })
        .catch(() => {
          if (!cancelled) setCompras([]);
        });
    };
    load();
    const unsubscribe = ComprasDatabase.addChangeListener((event) => {
      if (event.companyId === companyId) load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [companyId]);

  const nowSV = currentSVYearMonth();
  const [month, setMonth] = useState(String(nowSV.month));
  const [year, setYear] = useState(String(nowSV.year));
  const [exporting, setExporting] = useState(false);
  const [sendingToDrive, setSendingToDrive] = useState(false);

  // Periods are El Salvador calendar months: `new Date('2026-10-01')` is UTC
  // midnight (Sept 30 in SV), which moved every document dated the 1st into
  // the previous month.
  const monthInvoices = useMemo(() => {
    const m = parseInt(month);
    const y = parseInt(year);
    return invoices.filter(inv =>
      isInSVMonth(inv.date, y, m) &&
      !DTE_EVENT_INVOICE_TYPES.has(inv.invoiceType) &&
      !inv.excludeFromLibrosIVA,
    );
  }, [invoices, month, year]);

  // Disclosure: how many invoices the POS/libros configuration is keeping out
  // of this export — always visible, never a silent omission (design §6.5).
  const excludedFromLibros = useMemo(() => {
    const m = parseInt(month);
    const y = parseInt(year);
    return invoices.filter(inv =>
      isInSVMonth(inv.date, y, m) &&
      !DTE_EVENT_INVOICE_TYPES.has(inv.invoiceType) &&
      !!inv.excludeFromLibrosIVA,
    ).length;
  }, [invoices, month, year]);

  // Completeness: COMPLETED ticket sales of the period not yet in any DTE —
  // the accountant reading only Libros IVA must know they exist.
  const [pendingTickets, setPendingTickets] = useState<number>(0);
  useEffect(() => {
    if (!company) return;
    const m = parseInt(month);
    const y = parseInt(year);
    // SV month bounds as UTC instants (the machine clock may not be on SV time).
    const mm = String(m).padStart(2, '0');
    const lastDay = String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
    const from = svInstant(`${y}-${mm}-01`, '00:00').toISOString();
    const to = new Date(svInstant(`${y}-${mm}-${lastDay}`, '23:59:59').getTime() + 999).toISOString();
    let cancelled = false;
    TicketDatabase.getNotConsolidated(company.id, from, to).then((tickets) => {
      if (!cancelled) setPendingTickets(tickets.length);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [company, month, year]);

  const monthCompras = useMemo(() => {
    const m = parseInt(month);
    const y = parseInt(year);
    return compras.filter(c => {
      if (c.internalUse === true) return false; // uso interno: fuera del Libro de Compras
      return isInSVMonth(c.fecha, y, m);
    });
  }, [compras, month, year]);

  // Counts by type
  const countsByType = useMemo(() => {
    const map: Partial<Record<InvoiceType, { total: number; completed: number; anulados: number }>> = {};
    for (const inv of monthInvoices) {
      if (!map[inv.invoiceType]) map[inv.invoiceType] = { total: 0, completed: 0, anulados: 0 };
      map[inv.invoiceType]!.total++;
      if (inv.status === InvoiceStatus.Completada) map[inv.invoiceType]!.completed++;
      if (inv.status === InvoiceStatus.Anulada) map[inv.invoiceType]!.anulados++;
    }
    return map;
  }, [monthInvoices]);

  if (!canUseLibrosIVA(tier)) {
    return (
      <div data-testid="libros-iva-locked" className="space-y-6">
        <PageHeader
          title="Libros de IVA"
          subtitle="Exportación de anexos F-07 para el Ministerio de Hacienda"
        />
        <Card className="max-w-xl mx-auto text-center py-10">
          <div className="w-14 h-14 mx-auto rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center mb-4">
            <BookOpen size={28} />
          </div>
          <h2 className="text-xl font-bold text-brand-900 mb-2">Disponible con Pro o Business</h2>
          <p className="text-sm text-brand-600 mb-5">
            Libros IVA no está disponible en el plan gratis. Actualiza tu suscripción
            para exportar anexos F-07 y enviarlos a Google Drive.
          </p>
          <FreeTrialOffer className="mb-4" />
          <Button variant="primary" onClick={() => navigate('/settings/promo')}>
            Ver planes
          </Button>
        </Card>
      </div>
    );
  }

  async function handleExport() {
    if (monthInvoices.length === 0 && monthCompras.length === 0) {
      toast.warning('No hay documentos para el período seleccionado.');
      return;
    }
    setExporting(true);
    try {
      const companyName = company?.nombreComercial || company?.nombre || 'empresa';
      const result = await MHAnnexExportService.exportMHAnexos(
        monthInvoices,
        monthCompras,
        companyName,
        { download: true, customers },
      );
      if (result.files.length > 0) {
        toast.success(`${result.files.length} archivo(s) CSV descargados correctamente.`);
      } else {
        toast.warning('No se generaron archivos. Verifica facturas completadas y compras.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al exportar.');
    } finally {
      setExporting(false);
    }
  }

  async function handleSendToDrive() {
    if (monthInvoices.length === 0 && monthCompras.length === 0) {
      toast.warning('No hay documentos para el período seleccionado.');
      return;
    }
    if (!(await GoogleAuthService.isSignedIn())) {
      toast.error('Conecta tu cuenta de Google en Configuración para subir a Drive.');
      return;
    }
    setSendingToDrive(true);
    try {
      const companyName = company?.nombreComercial || company?.nombre || 'empresa';
      const { artifacts } = await MHAnnexExportService.exportMHAnexos(
        monthInvoices,
        monthCompras,
        companyName,
        { download: false, customers },
      );
      if (artifacts.length === 0) {
        toast.warning('No se generaron archivos para subir.');
        return;
      }
      const period = `${year}-${month.padStart(2, '0')}`;
      const rootFolder = await GoogleDriveExportService.ensureFolder('SparkleWash');
      const libroFolder = await GoogleDriveExportService.ensureFolder(
        `LibrosIVA_${period}`,
        rootFolder,
      );
      for (const a of artifacts) {
        await GoogleDriveExportService.uploadFile({
          content: a.content,
          fileName: a.fileName,
          mimeType: a.mimeType,
          folderId: libroFolder,
          description: `Libros IVA ${period}`,
        });
      }
      toast.success(`${artifacts.length} archivo(s) subidos a Google Drive.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al subir a Drive.');
    } finally {
      setSendingToDrive(false);
    }
  }

  const typeEntries = Object.entries(countsByType) as [string, { total: number; completed: number; anulados: number }][];

  return (
    <div data-testid="libros-iva" className="space-y-6">
      <PageHeader
        title="Libros de IVA"
        subtitle="Exportación de anexos F-07 para el Ministerio de Hacienda"
      />

      {pendingTickets > 0 && (
        <div
          data-testid="libros-pending-tickets-banner"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2"
        >
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1">
            <strong>{pendingTickets} ticket{pendingTickets === 1 ? '' : 's'}</strong> de ventas del período aún no están consolidados en un DTE y no aparecen en este libro.
          </span>
          {canConsolidate && (
            <Button variant="secondary" size="sm" data-testid="btn-libros-goto-consolidate" onClick={() => navigate('/pos/consolidate')}>
              Consolidar
            </Button>
          )}
        </div>
      )}

      {excludedFromLibros > 0 && (
        <p data-testid="libros-excluded-counter" className="text-xs text-slate-500">
          {excludedFromLibros} factura{excludedFromLibros === 1 ? '' : 's'} excluida{excludedFromLibros === 1 ? '' : 's'} de este libro (POS / configuración).
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Month/Year selector */}
          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-4">Período</h2>
            <div className="flex gap-4">
              <div className="flex-1">
                <Select
                  label="Mes"
                  value={month}
                  onChange={e => setMonth(e.target.value)}
                  options={MONTHS}
                />
              </div>
              <div className="flex-1">
                <Select
                  label="Año"
                  value={year}
                  onChange={e => setYear(e.target.value)}
                  options={getYearOptions()}
                />
              </div>
            </div>
          </Card>

          {/* Preview Table */}
          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-4">
              Resumen — {MONTHS.find(m2 => m2.value === month)?.label} {year}
            </h2>
            {typeEntries.length === 0 ? (
              <p className="text-sm text-brand-400 py-4 text-center">No hay DTE declarables para este período.</p>
            ) : (
              <div className="overflow-auto rounded-lg border border-brand-100">
                <table className="w-full text-sm">
                  <thead className="bg-brand-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-brand-600">Tipo de DTE</th>
                      <th className="px-4 py-3 text-right font-semibold text-brand-600">Total</th>
                      <th className="px-4 py-3 text-right font-semibold text-brand-600">Completados</th>
                      <th className="px-4 py-3 text-right font-semibold text-brand-600">Anulados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typeEntries.map(([typeStr, counts]) => (
                      <tr key={typeStr} className="border-t border-brand-100">
                        <td className="px-4 py-3 text-brand-800">{typeName(parseInt(typeStr) as InvoiceType)}</td>
                        <td className="px-4 py-3 text-right text-brand-800">{counts.total}</td>
                        <td className="px-4 py-3 text-right text-green-700 font-medium">{counts.completed}</td>
                        <td className="px-4 py-3 text-right text-red-600">{counts.anulados}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-brand-300 bg-brand-50">
                      <td className="px-4 py-3 font-semibold text-brand-800">Total</td>
                      <td className="px-4 py-3 text-right font-semibold text-brand-900">{monthInvoices.length}</td>
                      <td className="px-4 py-3 text-right font-semibold text-green-700">
                        {monthInvoices.filter(i => i.status === InvoiceStatus.Completada).length}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-red-600">
                        {monthInvoices.filter(i => i.status === InvoiceStatus.Anulada).length}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-3">Archivos a generar</h2>
            <ul className="text-sm space-y-2 text-brand-600">
              <li className="flex items-center gap-2"><BookOpen size={14} className="text-accent-600" /> Anexo 1 — Ventas a Contribuyentes (CCF, NC, ND)</li>
              <li className="flex items-center gap-2"><BookOpen size={14} className="text-accent-600" /> Anexo 2 — Ventas Consumidor Final</li>
              <li className="flex items-center gap-2"><BookOpen size={14} className="text-accent-600" /> Anexo 3 — Compras con crédito fiscal (CCF, NC, ND)</li>
              <li className="flex items-center gap-2"><BookOpen size={14} className="text-accent-600" /> Anexo 5 — Compras a Sujetos Excluidos (FSE)</li>
              <li className="flex items-center gap-2"><BookOpen size={14} className="text-accent-600" /> Anulados</li>
            </ul>
            <p className="text-xs text-brand-400 mt-3">
              Formato UTF-8 BOM, separado por punto y coma, sin encabezados.
            </p>
          </Card>

          <Button
            variant="primary"
            size="lg"
            icon={<Download size={16} />}
            loading={exporting}
            onClick={handleExport}
            className="w-full"
            disabled={monthInvoices.length === 0 && monthCompras.length === 0}
          >
            Descargar Libros IVA
          </Button>

          <Button
            variant="secondary"
            size="lg"
            icon={<Cloud size={16} />}
            loading={sendingToDrive}
            onClick={handleSendToDrive}
            className="w-full"
            disabled={monthInvoices.length === 0 && monthCompras.length === 0}
          >
            Enviar a Google Drive
          </Button>
          <p className="text-xs text-brand-400 -mt-2">
            {monthCompras.length > 0
              ? `${monthInvoices.length} DTE · ${monthCompras.length} compras`
              : `${monthInvoices.length} DTE (sin compras del periodo)`}
          </p>
        </div>
      </div>
    </div>
  );
}
