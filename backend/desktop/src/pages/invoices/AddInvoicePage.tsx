import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileText, CreditCard, TrendingDown, Users, TrendingUp, Truck,
  Layers, Globe, Receipt, BookOpen, Heart, ArrowLeft, ArrowRight, Check, Building2, Undo
} from 'lucide-react';
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
import { selectCurrentCompanyCustomers } from '@/store/selectors/customerSelectors';
import { selectCurrentCompanyProducts } from '@/store/selectors/productSelectors';
import { selectCurrentCompanyInvoices } from '@/store/selectors/invoiceSelectors';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import { addInvoice } from '@/store/slices/invoiceSlice';
import { InvoiceGenerationService } from '@/services/invoiceGeneration/InvoiceGenerationService';
import { canCreateInvoice, getMaxInvoicesPerMonth } from '@/services/subscription/FeatureGate';
import { SubscriptionModal } from '@/components/modals/SubscriptionModal';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { InvoiceType, InvoiceStatus, InvoiceDetail } from '@/types/invoice';
import { CompanyEnvironment } from '@/types/company';
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
import { nanoid } from '@reduxjs/toolkit';
import { svDateOf, svYearMonthOf, currentSVYearMonth, todaySV } from '@/utils/svDate';
import { REQUIRED_PARENT_MESSAGE, eligibleParents } from '@/services/invoices/linkedDocumentRules';

interface DteTypeCard {
  type: InvoiceType;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const STANDARD_DTE_TYPES: DteTypeCard[] = [
  { type: InvoiceType.Factura, label: 'Factura CF', description: 'Venta a consumidor final', icon: <FileText size={24} /> },
  { type: InvoiceType.CCF, label: 'CCF', description: 'Comprobante de Crédito Fiscal', icon: <CreditCard size={24} /> },
  { type: InvoiceType.NotaCredito, label: 'Nota de Crédito', description: 'Corrección sobre CCF anterior', icon: <TrendingDown size={24} /> },
  { type: InvoiceType.SujetoExcluido, label: 'Sujeto Excluido', description: 'Compra a sujeto excluido de IVA', icon: <Users size={24} /> },
  { type: InvoiceType.NotaDebito, label: 'Nota de Débito', description: 'Incremento sobre CCF anterior', icon: <TrendingUp size={24} /> },
  { type: InvoiceType.NotaRemision, label: 'Nota de Remisión', description: 'Traslado de mercancías', icon: <Truck size={24} /> },
  { type: InvoiceType.ComprobanteLiquidacion, label: 'Comp. Liquidación', description: 'Liquidación de operaciones', icon: <Layers size={24} /> },
  { type: InvoiceType.FacturaExportacion, label: 'Exportación', description: 'Venta al exterior', icon: <Globe size={24} /> },
  { type: InvoiceType.ComprobanteRetencion, label: 'Retención', description: 'Comprobante de retención IVA', icon: <Receipt size={24} /> },
  { type: InvoiceType.DocumentoContableLiquidacion, label: 'Doc. Contable', description: 'Documento contable de liquidación', icon: <BookOpen size={24} /> },
  { type: InvoiceType.ComprobanteDonacion, label: 'Donación', description: 'Comprobante de donación', icon: <Heart size={24} /> },
];

const EVENT_DTE_TYPES: DteTypeCard[] = [
  {
    type: InvoiceType.EventoOperacionesEspeciales,
    label: 'Evento Operaciones Especiales (17)',
    description: 'Evento MH para operaciones especiales; no es factura ordinaria',
    icon: <Layers size={24} />,
  },
  {
    type: InvoiceType.EventoRetorno,
    label: 'Evento de Retorno (18)',
    description: 'Evento MH vinculado a DTE 01, 11 o 14 recibido',
    icon: <Undo size={24} />,
  },
];

const RETORNO_SOURCE_DOCUMENT_TYPES = new Set(['01', '11', '14']);
const RETORNO_SOURCE_REQUIRED_MESSAGE =
  'Selecciona un DTE origen válido (01, 11 o 14 completado con recepción MH) para guardar el Evento de Retorno.';

const stamp = () => new Date().toISOString();
// El Salvador calendar date. `toISOString()` is the UTC date: from 18:00 SV it
// is already tomorrow, so an Oct 31 19:30 invoice defaulted to Nov 1 and MH
// rejected it with 007 "Fuera de periodo tributario".
const today = () => todaySV();
const UUID_V4_REGEX = /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
const isIsoDateOnly = (value: string): boolean => {
  if (!value) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
};

function parseInvoiceTypeParam(value: string | null): InvoiceType | null {
  if (!value) return null;
  const namedTypes: Record<string, InvoiceType> = {
    EventoOperacionesEspeciales: InvoiceType.EventoOperacionesEspeciales,
    EventoRetorno: InvoiceType.EventoRetorno,
  };
  if (namedTypes[value] !== undefined) return namedTypes[value];

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed as InvoiceType;
}

interface FormData {
  date: string;
  customerId: string;
  relatedInvoiceId: string;
  operacionesEspecialesTipoDocumento: '02' | '97';
  operacionesEspecialesNumDocumento: string;
  operacionesEspecialesFechaEmision: string;
  operacionesEspecialesCodigoGeneracionRef: string;
  operacionesEspecialesDocDel: string;
  operacionesEspecialesDocAl: string;
  nombEntrega: string;
  docuEntrega: string;
  observaciones: string;
}

export default function AddInvoicePage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const customers = useAppSelector(selectCurrentCompanyCustomers);
  const products = useAppSelector(selectCurrentCompanyProducts);
  const companyInvoices = useAppSelector(selectCurrentCompanyInvoices);
  const company = useAppSelector(selectCurrentCompany);
  const tier = useAppSelector(selectCurrentTier);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [searchParams] = useSearchParams();

  // Query params from linked-document actions or duplicate:
  //   ?type=2&parentId=abc   → create NC linked to parent abc
  //   ?type=0&duplicateFrom=xyz  → clone invoice xyz as a new Factura
  const qpType = searchParams.get('type');
  const qpParentId = searchParams.get('parentId');
  const qpDuplicateFrom = searchParams.get('duplicateFrom');
  const routeInvoiceType = parseInvoiceTypeParam(qpType);

  const parentInvoice = qpParentId ? companyInvoices.find(i => i.id === qpParentId) : null;
  const duplicateSource = qpDuplicateFrom ? companyInvoices.find(i => i.id === qpDuplicateFrom) : null;

  const [step, setStep] = useState<1 | 2>(routeInvoiceType != null ? 2 : 1);
  const [selectedType, setSelectedType] = useState<InvoiceType | null>(
    routeInvoiceType,
  );

  // Auto-fill items from parent or duplicate source.
  const sourceInvoice = parentInvoice || duplicateSource;
  const [items, setItems] = useState<InvoiceDetail[]>(
    sourceInvoice?.items?.map((it, idx) => ({
      ...it,
      id: `${nanoid()}-${idx}`,
      invoiceId: '',
    })) ?? [],
  );
  const [form, setForm] = useState<FormData>({
    date: today(),
    customerId: sourceInvoice?.customerId ?? '',
    relatedInvoiceId: qpParentId ?? '',
    operacionesEspecialesTipoDocumento: '02',
    operacionesEspecialesNumDocumento: '',
    operacionesEspecialesFechaEmision: '',
    operacionesEspecialesCodigoGeneracionRef: '',
    operacionesEspecialesDocDel: '',
    operacionesEspecialesDocAl: '',
    nombEntrega: duplicateSource?.nombEntrega ?? '',
    docuEntrega: duplicateSource?.docuEntrega ?? '',
    observaciones: duplicateSource?.observaciones ?? '',
  });
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermsDraft>(
    paymentTermsFromSource(duplicateSource ?? undefined),
  );
  // FSE "Aplicar retención de renta (10%)" — ON by default (a duplicated FSE
  // keeps its source's choice).
  const [applyRentaRetention, setApplyRentaRetention] = useState<boolean>(
    duplicateSource?.invoiceType === InvoiceType.SujetoExcluido
      ? duplicateSource.applyRentaRetention ?? documentWithholdings(duplicateSource).options.applyRentaRetention
      : true,
  );
  const [saving, setSaving] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerDropOpen, setCustomerDropOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const customerWrapperRef = useRef<HTMLDivElement>(null);
  const [saveError, setSaveError] = useState(false);
  const [retornoValidationError, setRetornoValidationError] = useState<string | null>(null);
  const [formDataBackup, setFormDataBackup] = useState<{
    form: FormData;
    items: InvoiceDetail[];
    paymentTerms: PaymentTermsDraft;
  } | null>(null);

  // Undo functionality: restore form data if save fails within 10 seconds
  useEffect(() => {
    if (saveError && formDataBackup) {
      // Restore form data
      setForm(formDataBackup.form);
      setItems(formDataBackup.items);
      setPaymentTerms(formDataBackup.paymentTerms);
      setSaveError(false);
      toast.info('Datos restaurados tras error de guardado.');
      setFormDataBackup(null);
    }
  }, [saveError, formDataBackup]);

  useEffect(() => {
    // Clear backup on navigation
    return () => {
      if (saveError && formDataBackup) {
        setForm(formDataBackup.form);
        setItems(formDataBackup.items);
        setPaymentTerms(formDataBackup.paymentTerms);
      }
    };
  }, [saveError, formDataBackup]);

  // Block invoice creation when no company is selected. The previous code
  // silently fell back to DEFAULT_COMPANY_ID, which produced garbage DTEs and
  // sync failures downstream.
  if (!company) {
    return (
      <div data-testid="invoice-add-no-company" className="max-w-md mx-auto mt-12">
        <Card>
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
              <Building2 size={22} />
            </div>
            <h2 className="text-lg font-semibold text-brand-900">
              Selecciona o crea una empresa
            </h2>
            <p className="text-sm text-brand-500">
              Necesitas tener una empresa con NIT y certificado para emitir un DTE.
            </p>
            <div className="flex gap-2 mt-2">
              <Button variant="primary" onClick={() => navigate('/companies/add')} data-testid="btn-go-create-company">
                Crear empresa
              </Button>
              <Button variant="secondary" onClick={() => navigate('/companies')}>
                Ver empresas
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // Free-tier monthly cap — corrections to existing docs (parentId) are exempt.
  const invoicesThisMonth = useMemo(() => {
    const { year, month } = currentSVYearMonth();
    return companyInvoices.filter((inv) => {
      const ym = svYearMonthOf(inv.createdAt ?? inv.date);
      return !!ym && ym.year === year && ym.month === month;
    }).length;
  }, [companyInvoices]);

  const isLinkedDoc = !!qpParentId;
  // Test (Pruebas) companies are exempt from the Free-tier cap — see getMaxInvoicesPerMonth.
  const isLiveCompany =
    company?.environment === CompanyEnvironment.Production && company?.isTestAccount !== true;
  const canCreate = isLinkedDoc || canCreateInvoice(tier, invoicesThisMonth, isLiveCompany);
  const maxPerMonth = getMaxInvoicesPerMonth(tier, isLiveCompany);

  if (!canCreate) {
    return (
      <>
        <div data-testid="invoice-add-limit-reached" className="max-w-md mx-auto mt-12">
          <Card>
            <div className="flex flex-col items-center text-center gap-3 py-6">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                <FileText size={22} />
              </div>
              <h2 className="text-lg font-semibold text-brand-900">
                Límite mensual alcanzado
              </h2>
              <p className="text-sm text-brand-500">
                Has creado <strong>{invoicesThisMonth}</strong> de {maxPerMonth} facturas este mes en el plan Free.
                Mejora tu plan para continuar facturando sin límites.
              </p>
              <div className="flex gap-2 mt-2">
                <Button variant="primary" onClick={() => setShowUpgrade(true)}>
                  Ver planes
                </Button>
                <Button variant="secondary" onClick={() => navigate('/invoices')}>
                  Volver
                </Button>
              </div>
            </div>
          </Card>
        </div>
        <SubscriptionModal
          isOpen={showUpgrade}
          onClose={() => setShowUpgrade(false)}
          requiredTier={SubscriptionTier.AdFree}
          featureName="Facturas ilimitadas"
        />
      </>
    );
  }

  const companyId = company.id;

  const filteredCustomers = useMemo(() =>
    customers.filter(c =>
      `${c.firstName} ${c.lastName} ${c.businessName || ''} ${c.nit} ${c.nationalId}`
        .toLowerCase().includes(customerSearch.toLowerCase())
    ).slice(0, 8),
    [customers, customerSearch]
  );

  const selectedCustomer = customers.find(c => c.id === form.customerId) || null;
  const selectedTypeCard = [...STANDARD_DTE_TYPES, ...EVENT_DTE_TYPES].find(d => d.type === selectedType);
  const isEventType =
    selectedType === InvoiceType.EventoOperacionesEspeciales ||
    selectedType === InvoiceType.EventoRetorno;
  const supportsPaymentTerms = supportsInvoicePaymentTerms(selectedType);
  const isOperacionesEspecialesEvent = selectedType === InvoiceType.EventoOperacionesEspeciales;
  const isRetornoEvent = selectedType === InvoiceType.EventoRetorno;
  const operacionesEspecialesNumDocumento = form.operacionesEspecialesNumDocumento.trim();
  const operacionesEspecialesFechaEmision = form.operacionesEspecialesFechaEmision.trim();
  const operacionesEspecialesCodigoRef = form.operacionesEspecialesCodigoGeneracionRef.trim().toUpperCase();
  const operacionesEspecialesDocDel = form.operacionesEspecialesDocDel.trim();
  const operacionesEspecialesDocAl = form.operacionesEspecialesDocAl.trim();
  const operacionesEspecialesValidationMessage = (() => {
    if (!isOperacionesEspecialesEvent) return '';
    if (!operacionesEspecialesNumDocumento) return 'Ingresa el número del comprobante origen.';
    if (operacionesEspecialesFechaEmision && !isIsoDateOnly(operacionesEspecialesFechaEmision)) {
      return 'Usa fecha de origen en formato AAAA-MM-DD o déjala vacía.';
    }
    if (operacionesEspecialesCodigoRef && !UUID_V4_REGEX.test(operacionesEspecialesCodigoRef)) {
      return 'El código de generación de referencia debe ser UUID v4.';
    }
    if ((operacionesEspecialesDocDel && !operacionesEspecialesDocAl) || (!operacionesEspecialesDocDel && operacionesEspecialesDocAl)) {
      return 'Completa ambos campos del rango o deja ambos vacíos.';
    }
    return '';
  })();
  const isOperacionesEspecialesValid = !operacionesEspecialesValidationMessage;
  const routeRetornoSourceIsEligible = !!parentInvoice &&
    RETORNO_SOURCE_DOCUMENT_TYPES.has(parentInvoice.documentType) &&
    (parentInvoice.status === InvoiceStatus.Completada || parentInvoice.status === InvoiceStatus.Modificada) &&
    !!parentInvoice.generationCode &&
    !!(parentInvoice.receptionSeal || parentInvoice.fechaTransmision);
  const visibleEventTypes = useMemo(
    () => EVENT_DTE_TYPES.filter(dt =>
      dt.type !== InvoiceType.EventoRetorno || routeRetornoSourceIsEligible
    ),
    [routeRetornoSourceIsEligible]
  );

  const needsRelated =
    selectedType === InvoiceType.NotaCredito ||
    selectedType === InvoiceType.NotaDebito ||
    selectedType === InvoiceType.NotaRemision ||
    selectedType === InvoiceType.ComprobanteLiquidacion ||
    selectedType === InvoiceType.ComprobanteRetencion ||
    selectedType === InvoiceType.DocumentoContableLiquidacion ||
    isRetornoEvent;
  const needsRemision = selectedType === InvoiceType.NotaRemision;

  const relatedInvoices = useMemo(() => {
    // NC/ND → CCF only; NR/CL → CCF or Factura (linkedDocumentRules).
    const completed = eligibleParents(companyInvoices, selectedType);
    if (!isRetornoEvent) return completed;
    return completed.filter(inv =>
      RETORNO_SOURCE_DOCUMENT_TYPES.has(inv.documentType) &&
      !!inv.generationCode &&
      !!(inv.receptionSeal || inv.fechaTransmision)
    );
  }, [companyInvoices, isRetornoEvent, selectedType]);

  const isSujetoExcluido = selectedType === InvoiceType.SujetoExcluido;
  const carriesPerception = selectedType != null && IVA_PERCEPTION_INVOICE_TYPES.includes(selectedType);
  // IVA percepción 1%: decided now from the company / customer flags (and, on
  // NC/ND, the referenced CCF's stored totals) and stored on the invoice.
  const applyIvaPerception = ivaPerceptionApplies({
    invoiceType: selectedType,
    company,
    customer: selectedCustomer,
    parent: relatedInvoices.find(inv => inv.id === form.relatedInvoiceId) ?? null,
  });

  function handleSelectType(type: InvoiceType) {
    setSelectedType(type);
    setStep(2);
    setItems([]);
    setApplyRentaRetention(true);
    setPaymentTerms(paymentTermsFromSource());
    setRetornoValidationError(null);
  }

  async function handleSave() {
    // Backup form data before saving for potential undo
    setFormDataBackup({
      form: { ...form },
      items: JSON.parse(JSON.stringify(items)),
      paymentTerms: { ...paymentTerms },
    });

    if (!selectedType && selectedType !== 0) {
      setSaveError(true);
      toast.error('Selecciona un tipo de documento.');
      return;
    }
    const relatedInvoice = relatedInvoices.find(inv => inv.id === form.relatedInvoiceId);
    if (isRetornoEvent && !relatedInvoice) {
      setSaveError(false);
      setRetornoValidationError(RETORNO_SOURCE_REQUIRED_MESSAGE);
      toast.error(RETORNO_SOURCE_REQUIRED_MESSAGE);
      return;
    }
    const requiredParentMessage = selectedType != null ? REQUIRED_PARENT_MESSAGE[selectedType] : undefined;
    if (requiredParentMessage && !relatedInvoice) {
      setSaveError(false);
      toast.error(requiredParentMessage);
      return;
    }
    if (isOperacionesEspecialesEvent && !isOperacionesEspecialesValid) {
      setSaveError(true);
      toast.error(operacionesEspecialesValidationMessage);
      return;
    }
    if (items.length === 0) {
      setSaveError(true);
      toast.error('Agrega al menos un ítem.');
      return;
    }
    if (!form.date) {
      setSaveError(true);
      toast.error('Selecciona una fecha.');
      return;
    }
    // Exento / no sujeto lines on a type that only carries gravado sales
    // (CR, CL, DCL, events) would make DTEMappingService throw at send time.
    const blockedLines = blockedTaxCategoryLines(items, selectedType);
    if (blockedLines.length > 0) {
      setSaveError(false);
      toast.error(
        `La${blockedLines.length === 1 ? ' línea' : 's líneas'} ${blockedLines.map(i => i + 1).join(', ')} ` +
        'tiene(n) productos exentos o no sujetos que este tipo de documento no admite. Quítela(s) o cambie el tipo de documento.',
      );
      return;
    }
    setSaving(true);
    try {
      // Generate the MH-canonical numeroControl up front so the listing /
      // detail UI shows DTE-04-M001P001-NNNNNNNNNNNNNNN instead of a local
      // INV-{timestamp}. enrichForSubmission still re-checks at sign-time and
      // is idempotent if the format is valid — so this is just a UX win
      // (consistent identifier from creation). Sequence is the same time-
      // derived 15-digit fallback enrichForSubmission would have used.
      const sequence =
        (Date.now() % 10_000_000_000) * 100_000 + Math.floor(Math.random() * 100_000);
      const invoiceNumber = InvoiceGenerationService.generateControlNumber(
        selectedType!,
        sequence,
        company ?? undefined,
      );
      const paymentPayload = paymentTermsToPayload(paymentTerms, {
        supportsPaymentTerms,
        issueDate: form.date,
      });

      dispatch(addInvoice({
        invoiceNumber,
        date: form.date,
        ...paymentPayload,
        invoiceType: selectedType!,
        companyId,
        customerId: form.customerId || undefined,
        customer: selectedCustomer ?? undefined,
        items: items.map(item => ({
          productId: item.productId || `product_${nanoid(4)}`,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          obsItem: item.obsItem,
          // Exento / no sujeto lines must keep their category: without it the
          // slice stores them as gravado (wrong IVA and DTE bucket).
          taxCategory: item.taxCategory,
        })),
        // An electronic related DTE is referenced by its codigoGeneracion (MH);
        // the control number stays in relatedControlNumber for display.
        relatedDocumentNumber: isOperacionesEspecialesEvent
          ? operacionesEspecialesNumDocumento || undefined
          : relatedInvoice?.generationCode || relatedInvoice?.controlNumber,
        relatedDocumentType: isOperacionesEspecialesEvent
          ? form.operacionesEspecialesTipoDocumento
          : relatedInvoice?.documentType,
        relatedInvoiceType: relatedInvoice?.invoiceType,
        relatedControlNumber: relatedInvoice?.controlNumber,
        relatedGenerationCode: isOperacionesEspecialesEvent
          ? operacionesEspecialesCodigoRef || undefined
          : relatedInvoice?.generationCode,
        relatedReceptionSeal: relatedInvoice?.receptionSeal,
        relatedId: form.relatedInvoiceId || undefined,
        relatedDocumentDate: isOperacionesEspecialesEvent
          ? operacionesEspecialesFechaEmision || undefined
          : relatedInvoice?.date,
        specialOperationDocFrom: isOperacionesEspecialesEvent
          ? operacionesEspecialesDocDel || undefined
          : undefined,
        specialOperationDocTo: isOperacionesEspecialesEvent
          ? operacionesEspecialesDocAl || undefined
          : undefined,
        nombEntrega: form.nombEntrega || undefined,
        docuEntrega: form.docuEntrega || undefined,
        observaciones: form.observaciones || undefined,
        customerHasRetention: selectedCustomer?.hasContributorRetention,
        applyRentaRetention: isSujetoExcluido ? applyRentaRetention : undefined,
        applyIvaPerception: carriesPerception ? applyIvaPerception : undefined,
      }));

      toast.success(isEventType ? 'Evento creado correctamente.' : 'DTE creado correctamente.');
      // navigate to the invoice that was just created
      navigate('/invoices');
    } catch (err) {
      // Save failed — restore form data
      setSaveError(true);
      toast.error(err instanceof Error ? err.message : 'Error al guardar. Se restaurarán los datos.');
    } finally {
      setSaving(false);
    }
  }

  function handleUndo() {
    if (!formDataBackup) return;
    setForm(formDataBackup.form);
    setItems(JSON.parse(JSON.stringify(formDataBackup.items)));
    setPaymentTerms(formDataBackup.paymentTerms);
    setFormDataBackup(null);
    setSaveError(false);
    toast.info('Datos restaurados.');
  }

  return (
    <div data-testid="add-invoice" className="space-y-6">
      {step === 1 && (
        <>
          <div>
            <button
              onClick={() => navigate('/invoices')}
              className="flex items-center gap-2 text-sm text-brand-500 hover:text-brand-700 mb-4"
            >
              <ArrowLeft size={16} /> Volver
            </button>
            <PageHeader
              title="Nuevo DTE o Evento"
              subtitle="Paso 1 — Selecciona el tipo de documento o evento"
            />
          </div>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-brand-800">Documentos DTE</h2>
              <p className="text-xs text-brand-400">
                Comprobantes tributarios ordinarios para ventas, compras, ajustes y traslados.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {STANDARD_DTE_TYPES.map(dt => (
                <button
                  key={dt.type}
                  type="button"
                  onClick={() => handleSelectType(dt.type)}
                  className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-brand-200 bg-white hover:border-accent-500 hover:shadow-md transition-all text-center group"
                  data-testid={`dte-type-card-${dt.type}`}
                >
                  <div className="text-brand-400 group-hover:text-accent-600 transition-colors">
                    {dt.icon}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-brand-800">{dt.label}</p>
                    <p className="text-xs text-brand-400 mt-0.5">{dt.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3" data-testid="eventos-mh-dte-group">
            <div>
              <h2 className="text-sm font-semibold text-brand-800">Eventos MH/DTE</h2>
              <p className="text-xs text-brand-400">
                Registros para informar eventos ante Hacienda. No reemplazan la emisión de una factura, CCF u otro DTE ordinario.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {visibleEventTypes.map(dt => (
              <button
                key={dt.type}
                type="button"
                onClick={() => handleSelectType(dt.type)}
                className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-brand-200 bg-white hover:border-accent-500 hover:shadow-md transition-all text-center group"
                data-testid={`dte-type-card-${dt.type}`}
              >
                <div className="text-brand-400 group-hover:text-accent-600 transition-colors">
                  {dt.icon}
                </div>
                <div>
                  <p className="font-semibold text-sm text-brand-800">{dt.label}</p>
                  <p className="text-xs text-brand-400 mt-0.5">{dt.description}</p>
                </div>
              </button>
            ))}
            </div>
          </section>
        </>
      )}

      {step === 2 && selectedType !== null && (
        <>
          <div>
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-2 text-sm text-brand-500 hover:text-brand-700 mb-4"
            >
              <ArrowLeft size={16} /> Cambiar tipo
            </button>
            <PageHeader
              title={`${isEventType ? 'Nuevo' : 'Nuevo'} ${selectedTypeCard?.label ?? 'DTE'}`}
              subtitle={isEventType ? 'Paso 2 — Completa los datos del evento MH/DTE' : 'Paso 2 — Completa los datos del documento'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Basic Info */}
              <Card>
                <h2 className="text-base font-semibold text-brand-800 mb-4">Información General</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <DatePicker
                    label="Fecha"
                    value={form.date}
                    onChange={v => setForm(f => ({ ...f, date: v }))}
                    required
                  />
                  {/* Customer Picker */}
                  <div
                    className="relative"
                    ref={customerWrapperRef}
                    onBlur={e => {
                      // Close only when focus leaves the entire wrapper.
                      if (!customerWrapperRef.current?.contains(e.relatedTarget as Node)) {
                        setCustomerDropOpen(false);
                        setHighlightedIndex(-1);
                      }
                    }}
                  >
                    <label
                      htmlFor="customer-search"
                      className="text-sm font-medium text-brand-700 block mb-1"
                    >
                      {isOperacionesEspecialesEvent ? 'Contraparte opcional' : 'Cliente'}
                    </label>
                    <input
                      id="customer-search"
                      type="text"
                      role="combobox"
                      aria-expanded={customerDropOpen && filteredCustomers.length > 0}
                      aria-controls="customer-listbox"
                      aria-autocomplete="list"
                      aria-activedescendant={highlightedIndex >= 0 ? `customer-option-${highlightedIndex}` : undefined}
                      value={selectedCustomer
                        ? (selectedCustomer.businessName || `${selectedCustomer.firstName} ${selectedCustomer.lastName}`)
                        : customerSearch}
                      onChange={e => {
                        setCustomerSearch(e.target.value);
                        setHighlightedIndex(-1);
                        setCustomerDropOpen(true);
                        if (!e.target.value) setForm(f => ({ ...f, customerId: '' }));
                      }}
                      onFocus={() => setCustomerDropOpen(true)}
                      onKeyDown={e => {
                        if (!customerDropOpen || filteredCustomers.length === 0) return;
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setHighlightedIndex(i => Math.min(i + 1, filteredCustomers.length - 1));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setHighlightedIndex(i => Math.max(i - 1, 0));
                        } else if (e.key === 'Enter' && highlightedIndex >= 0) {
                          e.preventDefault();
                          const c = filteredCustomers[highlightedIndex];
                          setForm(f => ({ ...f, customerId: c.id }));
                          setCustomerSearch(c.businessName || `${c.firstName} ${c.lastName}`);
                          setCustomerDropOpen(false);
                          setHighlightedIndex(-1);
                        } else if (e.key === 'Escape') {
                          setCustomerDropOpen(false);
                          setHighlightedIndex(-1);
                        }
                      }}
                      placeholder="Buscar cliente..."
                      className="w-full rounded-lg border border-brand-300 px-3 py-2 text-sm text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                    />
                    {customerDropOpen && filteredCustomers.length > 0 && (
                      <div
                        id="customer-listbox"
                        role="listbox"
                        className="absolute z-20 top-full left-0 w-full mt-1 bg-white border border-brand-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
                      >
                        {filteredCustomers.map((c, idx) => (
                          <div
                            key={c.id}
                            id={`customer-option-${idx}`}
                            role="option"
                            aria-selected={idx === highlightedIndex}
                            className={[
                              'w-full text-left px-3 py-2 text-sm text-brand-800 cursor-pointer',
                              idx === highlightedIndex ? 'bg-brand-100' : 'hover:bg-brand-50',
                            ].join(' ')}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => {
                              setForm(f => ({ ...f, customerId: c.id }));
                              setCustomerSearch(c.businessName || `${c.firstName} ${c.lastName}`);
                              setCustomerDropOpen(false);
                              setHighlightedIndex(-1);
                            }}
                          >
                            <span className="font-medium">{c.businessName || `${c.firstName} ${c.lastName}`}</span>
                            <span className="ml-2 text-brand-400 text-xs">{c.nit || c.nationalId}</span>
                          </div>
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
                    issueDate={form.date}
                  />
                </Card>
              )}

              {isOperacionesEspecialesEvent && (
                <Card>
                  <h2 className="text-base font-semibold text-brand-800 mb-2">
                    Operación especial CAT-023
                  </h2>
                  <p className="text-xs text-brand-500 mb-4">
                    Este evento reporta operaciones autorizadas con comprobantes de control interno o facturas de venta simplificadas.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                      label="Tipo de operación"
                      value={form.operacionesEspecialesTipoDocumento}
                      onChange={e => setForm(f => ({ ...f, operacionesEspecialesTipoDocumento: e.target.value as '02' | '97' }))}
                      options={[
                        { label: '02 — Factura de venta simplificada', value: '02' },
                        { label: '97 — Comprobantes de Control Interno', value: '97' },
                      ]}
                    />
                    <Input
                      label="Número de comprobante"
                      value={form.operacionesEspecialesNumDocumento}
                      onChange={e => setForm(f => ({ ...f, operacionesEspecialesNumDocumento: e.target.value }))}
                      placeholder="Comprobante interno o factura simplificada"
                      required
                    />
                    <Input
                      label="Fecha de emisión del comprobante"
                      type="date"
                      value={form.operacionesEspecialesFechaEmision}
                      onChange={e => setForm(f => ({ ...f, operacionesEspecialesFechaEmision: e.target.value }))}
                      helperText="Opcional; se envía null si no aplica."
                    />
                    <Input
                      label="Código generación EOE referencia"
                      value={form.operacionesEspecialesCodigoGeneracionRef}
                      onChange={e => setForm(f => ({ ...f, operacionesEspecialesCodigoGeneracionRef: e.target.value.toUpperCase() }))}
                      placeholder="Opcional"
                      error={
                        operacionesEspecialesCodigoRef && !UUID_V4_REGEX.test(operacionesEspecialesCodigoRef)
                          ? 'Debe ser UUID v4.'
                          : undefined
                      }
                    />
                    <Input
                      label="Documento desde"
                      value={form.operacionesEspecialesDocDel}
                      onChange={e => setForm(f => ({ ...f, operacionesEspecialesDocDel: e.target.value }))}
                      placeholder="Opcional"
                    />
                    <Input
                      label="Documento hasta"
                      value={form.operacionesEspecialesDocAl}
                      onChange={e => setForm(f => ({ ...f, operacionesEspecialesDocAl: e.target.value }))}
                      placeholder="Opcional"
                    />
                  </div>
                  {operacionesEspecialesValidationMessage && (
                    <p className="mt-3 text-sm text-red-600">{operacionesEspecialesValidationMessage}</p>
                  )}
                </Card>
              )}

              {/* Related document for credit/debit notes */}
              {needsRelated && (
                <Card>
                  <h2 className="text-base font-semibold text-brand-800 mb-2">
                    {isRetornoEvent ? 'DTE de origen para Retorno' : 'Documento Relacionado'}
                  </h2>
                  {isRetornoEvent && (
                    <p className="text-xs text-brand-500 mb-4">
                      El evento copiará del DTE origen el tipo, número de control, código de generación, sello de recepción y fecha de emisión.
                    </p>
                  )}
                  <Select
                    label={isRetornoEvent ? 'Selecciona el DTE origen' : 'Selecciona la factura relacionada'}
                    value={form.relatedInvoiceId}
                    onChange={e => {
                      setForm(f => ({ ...f, relatedInvoiceId: e.target.value }));
                      setRetornoValidationError(null);
                    }}
                    placeholder="-- Seleccionar --"
                    options={relatedInvoices.map(inv => ({
                      label: `${inv.documentType} — ${inv.controlNumber || inv.invoiceNumber} — ${svDateOf(inv.date)}`,
                      value: inv.id,
                    }))}
                  />
                  {isRetornoEvent && retornoValidationError && (
                    <p
                      role="alert"
                      data-testid="retorno-source-error"
                      className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3"
                    >
                      {retornoValidationError}
                    </p>
                  )}
                  {isRetornoEvent && relatedInvoices.length === 0 && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
                      No hay DTE 01, 11 o 14 completados con código de generación y recepción MH para registrar retorno.
                    </p>
                  )}
                </Card>
              )}

              {/* Remision fields */}
              {needsRemision && (
                <Card>
                  <h2 className="text-base font-semibold text-brand-800 mb-4">Datos de Entrega</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                      label="Nombre de quien entrega"
                      value={form.nombEntrega}
                      onChange={e => setForm(f => ({ ...f, nombEntrega: e.target.value }))}
                    />
                    <Input
                      label="Documento de quien entrega"
                      value={form.docuEntrega}
                      onChange={e => setForm(f => ({ ...f, docuEntrega: e.target.value }))}
                    />
                    <div className="sm:col-span-2">
                      <Input
                        label="Observaciones"
                        value={form.observaciones}
                        onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))}
                      />
                    </div>
                  </div>
                </Card>
              )}

              {/* Line Items */}
              <Card>
                <h2 className="text-base font-semibold text-brand-800 mb-4">Ítems</h2>
                <InvoiceLineItems
                  items={items}
                  onChange={setItems}
                  products={products}
                  supportDiscount={supportsLineDiscounts(selectedType)}
                  invoiceType={selectedType}
                />
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              <Card>
                <h2 className="text-base font-semibold text-brand-800 mb-3">Totales</h2>
                <InvoiceTotals
                  items={items}
                  invoiceType={selectedType}
                  customerHasRetention={selectedCustomer?.hasContributorRetention}
                  applyRentaRetention={isSujetoExcluido ? applyRentaRetention : undefined}
                  applyIvaPerception={applyIvaPerception}
                />
                {company.isPerceptionAgent && carriesPerception && selectedType != null && (
                  <PerceptionNote applies={applyIvaPerception} invoiceType={selectedType} />
                )}
              </Card>

              <div className="flex gap-2">
                {saveError && (
                  <Button
                    variant="secondary"
                    icon={<Undo size={16} />}
                    onClick={handleUndo}
                    data-testid="btn-undo-save"
                  >
                    Deshacer
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="lg"
                  icon={<Check size={16} />}
                  loading={saving}
                  onClick={handleSave}
                  className="w-full"
                  data-testid="btn-save"
                >
                  {isEventType ? 'Guardar Evento' : 'Guardar DTE'}
                </Button>
              </div>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => navigate('/invoices')}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
