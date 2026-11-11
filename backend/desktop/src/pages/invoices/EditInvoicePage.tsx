import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Select } from '@/components/common/Select';
import { Input } from '@/components/common/Input';
import { DatePicker } from '@/components/forms/DatePicker';
import { InvoiceLineItems, supportsLineDiscounts } from '@/components/invoices/InvoiceLineItems';
import { InvoiceTotals, PerceptionNote, RentaRetentionOption } from '@/components/invoices/InvoiceTotals';
import { PaymentTermsFields } from '@/components/invoices/PaymentTermsFields';
import { useToast } from '@/components/common/Toast';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectAllCustomers } from '@/store/selectors/customerSelectors';
import { selectAllProducts } from '@/store/selectors/productSelectors';
import { selectAllInvoices } from '@/store/selectors/invoiceSelectors';
import { selectAllCompanies } from '@/store/selectors/companySelectors';
import { updateInvoice } from '@/store/slices/invoiceSlice';
import { InvoiceStatus, InvoiceType, InvoiceDetail } from '@/types/invoice';
import {
  paymentTermsFromSource,
  paymentTermsToPayload,
  supportsInvoicePaymentTerms,
  type PaymentTermsDraft,
} from '@/utils/paymentTerms';
import {
  blockedTaxCategoryLines,
  documentWithholdings,
  ivaPerceptionApplies,
  IVA_PERCEPTION_INVOICE_TYPES,
} from '@/utils/invoiceTotals';
import { svDateOf } from '@/utils/svDate';
import { REQUIRED_PARENT_MESSAGE, eligibleParents } from '@/services/invoices/linkedDocumentRules';

export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const invoices = useAppSelector(selectAllInvoices);
  const customers = useAppSelector(selectAllCustomers);
  const products = useAppSelector(selectAllProducts);
  const companies = useAppSelector(selectAllCompanies);

  const invoice = invoices.find(inv => inv.id === id) || null;

  const [items, setItems] = useState<InvoiceDetail[]>(invoice?.items ?? []);
  // SV calendar date — `substring(0, 10)` of an ISO timestamp (POS
  // consolidations) is the UTC date, a day ahead from 18:00 SV.
  const [date, setDate] = useState(svDateOf(invoice?.date));
  const [customerId, setCustomerId] = useState(invoice?.customerId ?? '');
  const [relatedInvoiceId, setRelatedInvoiceId] = useState(invoice?.relatedId ?? '');
  const [nombEntrega, setNombEntrega] = useState(invoice?.nombEntrega ?? '');
  const [docuEntrega, setDocuEntrega] = useState(invoice?.docuEntrega ?? '');
  const [observaciones, setObservaciones] = useState(invoice?.observaciones ?? '');
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermsDraft>(
    paymentTermsFromSource(invoice ?? undefined),
  );
  // FSE "Aplicar retención de renta (10%)" — the stored choice (flag, else the
  // stored totals; absent = ON).
  const storedRenta = (inv: typeof invoice) =>
    !inv || (inv.applyRentaRetention ?? documentWithholdings(inv).options.applyRentaRetention);
  const [applyRentaRetention, setApplyRentaRetention] = useState<boolean>(storedRenta(invoice));
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerDropOpen, setCustomerDropOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-seed all form state when the invoice arrives/changes (deep-link /
  // rehydration race). Without this, the form stays blank even after the
  // invoice loads and "Actualizar" overwrites the record with empty values.
  useEffect(() => {
    if (!invoice) return;
    setItems(invoice.items ?? []);
    setDate(svDateOf(invoice.date));
    setCustomerId(invoice.customerId ?? '');
    setRelatedInvoiceId(invoice.relatedId ?? '');
    setNombEntrega(invoice.nombEntrega ?? '');
    setDocuEntrega(invoice.docuEntrega ?? '');
    setObservaciones(invoice.observaciones ?? '');
    setPaymentTerms(paymentTermsFromSource(invoice));
    setApplyRentaRetention(storedRenta(invoice));
  }, [invoice?.id, invoice?.updatedAt]);

  const companyCustomers = useMemo(
    () => customers.filter((c) => c.companyId === invoice?.companyId),
    [customers, invoice?.companyId],
  );

  const companyProducts = useMemo(
    () => products.filter((p) => p.companyId === invoice?.companyId),
    [products, invoice?.companyId],
  );

  const filteredCustomers = useMemo(() =>
    companyCustomers.filter(c =>
      `${c.firstName} ${c.lastName} ${c.businessName || ''} ${c.nit} ${c.nationalId}`
        .toLowerCase().includes(customerSearch.toLowerCase())
    ).slice(0, 8),
    [companyCustomers, customerSearch]
  );

  const selectedCustomer = companyCustomers.find(c => c.id === customerId) || null;
  // Same parent rules as creation (NC/ND → CCF), and a parent already
  // corrected by another note (Modificada) stays linkable — it used to drop
  // out of this list, so saving wiped the NC's whole documento relacionado.
  const relatedInvoices = eligibleParents(
    invoices.filter(inv => inv.companyId === invoice?.companyId && inv.id !== id),
    invoice?.invoiceType,
  );

  if (!invoice) {
    return (
      <div data-testid="edit-invoice">
        <PageHeader title="Factura no encontrada" />
        <Card><p className="text-brand-500">La factura solicitada no existe.</p></Card>
      </div>
    );
  }

  const canEdit = invoice.status === InvoiceStatus.Nueva || invoice.status === InvoiceStatus.ErrorEnvio;

  if (!canEdit) {
    return (
      <div data-testid="edit-invoice">
        <button
          onClick={() => navigate(`/invoices/${id}`)}
          className="flex items-center gap-2 text-sm text-brand-500 hover:text-brand-700 mb-4"
        >
          <ArrowLeft size={16} /> Volver
        </button>
        <PageHeader title="No editable" subtitle="Esta factura no puede ser editada en su estado actual." />
        <Card>
          <p className="text-brand-500 text-sm">Solo las facturas con estado Nueva o Error de Envío pueden editarse.</p>
          <Button className="mt-4" variant="secondary" onClick={() => navigate(`/invoices/${id}`)}>
            Ver Detalle
          </Button>
        </Card>
      </div>
    );
  }

  const needsRelated = invoice.invoiceType === InvoiceType.NotaCredito || invoice.invoiceType === InvoiceType.NotaDebito;
  const needsRemision = invoice.invoiceType === InvoiceType.NotaRemision;
  const supportsPaymentTerms = supportsInvoicePaymentTerms(invoice.invoiceType);
  const isSujetoExcluido = invoice.invoiceType === InvoiceType.SujetoExcluido;
  const carriesPerception = IVA_PERCEPTION_INVOICE_TYPES.includes(invoice.invoiceType);
  const company = companies.find(c => c.id === invoice.companyId) ?? null;
  // IVA percepción re-decided on edit from the current company / customer
  // flags (and the referenced CCF). A NC/ND whose parent isn't in this device
  // keeps its stored decision.
  const parentInvoice = needsRelated
    ? invoices.find(inv => inv.id === (relatedInvoiceId || invoice.relatedId)) ?? null
    : null;
  const applyIvaPerception = needsRelated && !parentInvoice
    ? (invoice.applyIvaPerception ?? documentWithholdings(invoice).options.applyIvaPerception)
    : ivaPerceptionApplies({
        invoiceType: invoice.invoiceType,
        company,
        customer: selectedCustomer,
        parent: parentInvoice,
      });

  async function handleSave() {
    if (!invoice) return;
    if (items.length === 0) {
      toast.error('Agrega al menos un ítem.');
      return;
    }
    // Exento / no sujeto lines on a type that only carries gravado sales
    // (CR, CL, DCL, events) would make DTEMappingService throw at send time.
    const blockedLines = blockedTaxCategoryLines(items, invoice.invoiceType);
    if (blockedLines.length > 0) {
      toast.error(
        `La${blockedLines.length === 1 ? ' línea' : 's líneas'} ${blockedLines.map(i => i + 1).join(', ')} ` +
        'tiene(n) productos exentos o no sujetos que este tipo de documento no admite. Quítela(s) o cambie el tipo de documento.',
      );
      return;
    }
    // Related-document fields are rewritten ONLY when the user picked a
    // different parent here. Everything else (event 17's manual reference,
    // NR/CL/CR links this form doesn't edit, a parent that left the list)
    // keeps its stored values — sending `undefined` wiped them.
    const relatedChanged = needsRelated && relatedInvoiceId !== (invoice.relatedId ?? '');
    const relatedInv = relatedChanged
      ? relatedInvoices.find(inv => inv.id === relatedInvoiceId)
      : undefined;
    const hasStoredParent = !!(invoice.relatedGenerationCode || invoice.relatedDocumentNumber || invoice.relatedId);
    const requiredParentMessage = REQUIRED_PARENT_MESSAGE[invoice.invoiceType];
    if (requiredParentMessage && (relatedChanged ? !relatedInv : !hasStoredParent)) {
      toast.error(requiredParentMessage);
      return;
    }
    const relatedFields = relatedInv
      ? {
          // Electronic related DTE → its codigoGeneracion (MH); keep every related
          // field in step when the user picks a different related document.
          relatedDocumentNumber: relatedInv.generationCode || relatedInv.controlNumber,
          relatedGenerationCode: relatedInv.generationCode,
          relatedControlNumber: relatedInv.controlNumber,
          relatedReceptionSeal: relatedInv.receptionSeal,
          relatedDocumentType: relatedInv.documentType,
          relatedInvoiceType: relatedInv.invoiceType,
          relatedId: relatedInv.id,
          relatedDocumentDate: relatedInv.date,
        }
      : {};
    setSaving(true);
    try {
      const paymentPayload = paymentTermsToPayload(paymentTerms, {
        supportsPaymentTerms,
        issueDate: date,
      });
      dispatch(updateInvoice({
        id: invoice.id,
        // Unchanged calendar date → keep the stored value (an ISO timestamp
        // also carries the emission time).
        date: date === svDateOf(invoice.date) ? invoice.date : date,
        ...paymentPayload,
        customerId: customerId || undefined,
        customer: selectedCustomer ?? undefined,
        items: items.map(item => ({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          obsItem: item.obsItem,
          // Exento / no sujeto lines must keep their category: without it the
          // slice stores them as gravado (wrong IVA and DTE bucket).
          taxCategory: item.taxCategory,
        })),
        ...relatedFields,
        nombEntrega: nombEntrega || undefined,
        docuEntrega: docuEntrega || undefined,
        observaciones: observaciones || undefined,
        customerHasRetention: selectedCustomer?.hasContributorRetention,
        applyRentaRetention: isSujetoExcluido ? applyRentaRetention : undefined,
        applyIvaPerception: carriesPerception ? applyIvaPerception : undefined,
      }));
      toast.success('Factura actualizada correctamente.');
      navigate(`/invoices/${invoice!.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="edit-invoice" className="space-y-6">
      <div>
        <button
          onClick={() => navigate(`/invoices/${id}`)}
          className="flex items-center gap-2 text-sm text-brand-500 hover:text-brand-700 mb-4"
        >
          <ArrowLeft size={16} /> Volver al Detalle
        </button>
        <PageHeader
          title={`Editar — ${invoice.controlNumber || invoice.invoiceNumber}`}
          subtitle="Modifica los datos del documento"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-4">Información General</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DatePicker label="Fecha" value={date} onChange={setDate} required />
              <div className="relative">
                <label className="text-sm font-medium text-brand-700 block mb-1">Cliente</label>
                <input
                  type="text"
                  value={selectedCustomer
                    ? (selectedCustomer.businessName || `${selectedCustomer.firstName} ${selectedCustomer.lastName}`)
                    : customerSearch}
                  onChange={e => {
                    setCustomerSearch(e.target.value);
                    setCustomerDropOpen(true);
                    if (!e.target.value) setCustomerId('');
                  }}
                  onFocus={() => setCustomerDropOpen(true)}
                  placeholder="Buscar cliente..."
                  className="w-full rounded-lg border border-brand-300 px-3 py-2 text-sm text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                />
                {customerDropOpen && filteredCustomers.length > 0 && (
                  <div className="absolute z-20 top-full left-0 w-full mt-1 bg-white border border-brand-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredCustomers.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 text-brand-800"
                        onMouseDown={() => {
                          setCustomerId(c.id);
                          setCustomerSearch(c.businessName || `${c.firstName} ${c.lastName}`);
                          setCustomerDropOpen(false);
                        }}
                      >
                        <span className="font-medium">{c.businessName || `${c.firstName} ${c.lastName}`}</span>
                        <span className="ml-2 text-brand-400 text-xs">{c.nit || c.nationalId}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {isSujetoExcluido && (
            <Card>
              <h2 className="text-base font-semibold text-brand-800 mb-3">Retención de renta</h2>
              <RentaRetentionOption checked={applyRentaRetention} onChange={setApplyRentaRetention} />
            </Card>
          )}

          {supportsPaymentTerms && (
            <Card>
              <h2 className="text-base font-semibold text-brand-800 mb-4">Condición de pago</h2>
              <PaymentTermsFields
                value={paymentTerms}
                onChange={setPaymentTerms}
                issueDate={date}
              />
            </Card>
          )}

          {needsRelated && (
            <Card>
              <h2 className="text-base font-semibold text-brand-800 mb-4">Documento Relacionado</h2>
              <Select
                label="Factura relacionada"
                value={relatedInvoiceId}
                onChange={e => setRelatedInvoiceId(e.target.value)}
                placeholder="-- Seleccionar --"
                options={relatedInvoices.map(inv => ({
                  label: `${inv.controlNumber || inv.invoiceNumber} — ${svDateOf(inv.date)}`,
                  value: inv.id,
                }))}
              />
            </Card>
          )}

          {needsRemision && (
            <Card>
              <h2 className="text-base font-semibold text-brand-800 mb-4">Datos de Entrega</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Nombre de quien entrega" value={nombEntrega} onChange={e => setNombEntrega(e.target.value)} />
                <Input label="Documento de quien entrega" value={docuEntrega} onChange={e => setDocuEntrega(e.target.value)} />
                <div className="sm:col-span-2">
                  <Input label="Observaciones" value={observaciones} onChange={e => setObservaciones(e.target.value)} />
                </div>
              </div>
            </Card>
          )}

          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-4">Ítems</h2>
            <InvoiceLineItems
              items={items}
              onChange={setItems}
              products={companyProducts}
              supportDiscount={supportsLineDiscounts(invoice.invoiceType)}
              invoiceType={invoice.invoiceType}
            />
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-3">Totales</h2>
            <InvoiceTotals
              items={items}
              invoiceType={invoice.invoiceType}
              customerHasRetention={selectedCustomer?.hasContributorRetention}
              applyRentaRetention={isSujetoExcluido ? applyRentaRetention : undefined}
              applyIvaPerception={applyIvaPerception}
            />
            {company?.isPerceptionAgent && carriesPerception && (
              <PerceptionNote applies={applyIvaPerception} invoiceType={invoice.invoiceType} />
            )}
          </Card>

          <Button
            variant="primary"
            size="lg"
            icon={<Save size={16} />}
            loading={saving}
            onClick={handleSave}
            className="w-full"
            data-testid="btn-update"
          >
            Actualizar Factura
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => navigate(`/invoices/${id}`)}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}
