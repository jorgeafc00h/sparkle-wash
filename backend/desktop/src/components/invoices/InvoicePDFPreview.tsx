// InvoicePDFPreview — visor a pantalla completa del PDF de una factura.
// Desktop (Vite + React 19 + Tailwind 4).
//
// Antes era un Modal size="lg" con altura fija de 60vh: el documento quedaba
// comprimido y desaprovechaba la ventana. Ahora el visor ocupa toda la ventana
// disponible de la app (overlay fixed inset-0), con el documento centrado sobre
// un fondo neutro — mismo patrón que el visor de PDF del navegador.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Mail, X } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Invoice, InvoiceType } from '@/types/invoice';
import { Company, CompanyEnvironment } from '@/types/company';
import { InvoicePDFGenerator, type PdfDocumentMode } from '@/services/pdf/InvoicePDFGenerator';
import { EmailService } from '@/services/email/EmailService';
import { EmailQueueService, uint8ArrayToBase64 } from '@/services/email/EmailQueueService';
import { useAppSelector } from '@/store';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import {
  canSendEmail,
  canSendEmailViaClient,
  requiresDesktopAdWait,
  requiresPdfWatermark,
} from '@/services/subscription/FeatureGate';
import { AD_CONFIG } from '@/config/subscriptionConfig';
import { useDesktopAdWait } from '@/hooks';
import { SubscriptionModal } from '@/components/modals/SubscriptionModal';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface InvoicePDFPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice;
  company: Company;
  documentMode?: PdfDocumentMode;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function InvoicePDFPreview({
  isOpen,
  onClose,
  invoice,
  company,
  documentMode = 'invoice',
}: InvoicePDFPreviewProps) {
  const [previewHTML, setPreviewHTML] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [exporting, setExporting] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | undefined>();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const generatedRef = useRef(false);
  const tier = useAppSelector(selectCurrentTier);
  const isUITesting = useAppSelector((s) => (s as { app: { isUITesting: boolean } }).app.isUITesting);
  const watermark = requiresPdfWatermark(tier);
  const canEmail = canSendEmail(tier);
  const canEmailViaClient = canSendEmailViaClient(tier);
  const isQuoteMode = documentMode === 'quote';
  // Company environment (not build env): test companies never wait.
  const isLivePreviewCompany =
    company?.isProduction === true || company?.environment === CompanyEnvironment.Production;
  const appEnvironment =
    import.meta.env.PROD && isLivePreviewCompany ? 'production' : 'development';
  const needsQuoteEmailAdWait = isQuoteMode && requiresDesktopAdWait(tier, appEnvironment, isUITesting);
  const { adWaiting, adSecondsRemaining, waitForDesktopAdIfNeeded, resetAdWait } = useDesktopAdWait(needsQuoteEmailAdWait);

  // Escape cierra el visor; se bloquea el scroll del fondo mientras está abierto.
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  function getEmailDocumentName() {
    if (isQuoteMode) return 'cotización';
    switch (invoice.invoiceType) {
      case InvoiceType.Factura:
        return 'Factura';
      case InvoiceType.CCF:
        return 'CCF';
      case InvoiceType.NotaCredito:
        return 'Nota de Crédito';
      case InvoiceType.NotaDebito:
        return 'Nota de Débito';
      case InvoiceType.NotaRemision:
        return 'Nota de Remisión';
      case InvoiceType.SujetoExcluido:
        return 'Factura de Sujeto Excluido';
      case InvoiceType.ComprobanteLiquidacion:
        return 'Comprobante de Liquidación';
      case InvoiceType.FacturaExportacion:
        return 'Factura de Exportación';
      case InvoiceType.EventoOperacionesEspeciales:
        return 'Evento de Operaciones Especiales';
      case InvoiceType.EventoRetorno:
        return 'Evento de Retorno';
      default:
        return 'documento';
    }
  }

  function getEmailActionLabel() {
    return `Enviar ${getEmailDocumentName()} por Email`;
  }

  function showEmailConfirmation(message: string) {
    window.alert(message);
  }

  // Generate HTML preview when the viewer opens
  useEffect(() => {
    if (!isOpen) {
      // Reset on close so it regenerates on next open
      generatedRef.current = false;
      setPreviewHTML('');
      setLoadError(undefined);
      setEmailStatus(undefined);
      resetAdWait();
      return;
    }

    if (generatedRef.current) return;
    generatedRef.current = true;

    setLoading(true);
    setLoadError(undefined);

    InvoicePDFGenerator.getPreviewHTML(invoice, company, { watermark, tier, documentMode })
      .then(html => {
        setPreviewHTML(html);
      })
      .catch(err => {
        setLoadError(
          err instanceof Error ? err.message : 'Error al generar la previsualización'
        );
      })
      .finally(() => setLoading(false));
  }, [isOpen, invoice, company, watermark, tier, documentMode]);

  async function handleDownload() {
    setExporting(true);
    try {
      await InvoicePDFGenerator.generateAndSavePDF(invoice, company, { watermark, tier, documentMode });
    } catch (err) {
      // silently fail — user sees browser/electron dialog feedback
    } finally {
      setExporting(false);
    }
  }

  async function handleSendEmail() {
    const allowed = isQuoteMode ? canEmailViaClient : canEmail;
    if (!allowed) {
      setShowUpgrade(true);
      return;
    }
    setEmailing(true);
    setEmailStatus(undefined);
    try {
      await waitForDesktopAdIfNeeded();
      const recipientEmail = invoice.customer?.email;
      const canSendViaApi = Boolean(recipientEmail && window.electronAPI?.printToPDF);

      if (canSendViaApi) {
        const pdfBuffer = await InvoicePDFGenerator.generatePDF(invoice, company, { watermark, tier, documentMode });
        if (pdfBuffer.byteLength > 0) {
          const pdfBase64 = uint8ArrayToBase64(pdfBuffer);
          const queued = isQuoteMode
            ? await EmailQueueService.queueQuoteEmail({ invoice, company, recipientEmail: recipientEmail!, pdfBase64 })
            : await EmailQueueService.queueInvoiceEmail({ invoice, company, recipientEmail: recipientEmail!, pdfBase64 });

          if (queued) {
            const message = isQuoteMode
              ? `Cotización enviada por Email a ${recipientEmail}.`
              : `Documento ${getEmailDocumentName()} enviado por Email a ${recipientEmail}.`;
            setEmailStatus(message);
            showEmailConfirmation(message);
            return;
          }
        }
      }

      const result = isQuoteMode
        ? await EmailService.sendQuoteByEmail(invoice, company, recipientEmail, { watermark, tier })
        : await EmailService.sendInvoiceByEmail(invoice, company, recipientEmail, { watermark, tier });
      if (result.success) {
        const message =
          isQuoteMode
            ? 'Cliente de correo abierto. Adjunte el PDF de cotización si es necesario.'
            : 'Cliente de correo abierto. Adjunte el PDF si es necesario.';
        setEmailStatus(message);
        showEmailConfirmation(message);
      } else {
        setEmailStatus(result.error ?? 'Error al abrir el cliente de correo.');
      }
    } catch (err) {
      setEmailStatus(
        err instanceof Error ? err.message : 'Error al enviar por correo.'
      );
    } finally {
      setEmailing(false);
      resetAdWait();
    }
  }

  // Note: previously we used a ref + doc.write() with sandbox="allow-same-origin",
  // but in Electron under the app:// protocol the sandboxed about:blank document
  // ended up null/inaccessible right after mount, leaving the preview blank.
  // Using `srcDoc` lets the browser parse the full HTML document (including
  // `<style>` tags) directly — and we drop `sandbox` because the HTML is fully
  // app-generated (no user-supplied script content can reach this string).

  if (!isOpen) return null;

  const footer = (
    <div className="flex items-center gap-2 w-full">
      {emailStatus && (
        <p className="text-xs text-brand-500 mr-auto">{emailStatus}</p>
      )}
      <div className="flex gap-2 ml-auto">
        <Button
          variant="secondary"
          icon={<Mail size={16} />}
          loading={emailing || adWaiting}
          onClick={handleSendEmail}
          disabled={loading || !!loadError || adWaiting}
          data-testid={isQuoteMode ? 'btn-preview-quote-email' : 'btn-preview-email'}
          className="whitespace-nowrap"
        >
          {getEmailActionLabel()}
        </Button>
        <Button
          variant="primary"
          icon={<Download size={16} />}
          loading={exporting}
          onClick={handleDownload}
          disabled={loading || !!loadError || adWaiting}
          data-testid="btn-preview-download"
        >
          Descargar PDF
        </Button>
        <Button
          variant="secondary"
          icon={<X size={16} />}
          onClick={onClose}
          data-testid="btn-preview-close"
        >
          Cerrar
        </Button>
      </div>
    </div>
  );

  return createPortal(
    <>
      <SubscriptionModal
        isOpen={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        requiredTier={SubscriptionTier.AdFree}
        featureName="Envío de DTE por correo"
      />
      <div
        data-testid={isQuoteMode ? 'quote-pdf-preview-modal' : 'invoice-pdf-preview-modal'}
        role="dialog"
        aria-modal="true"
        aria-label={isQuoteMode
          ? `Vista previa de cotización - ${invoice.invoiceNumber}`
          : `Vista previa - ${invoice.controlNumber || invoice.invoiceNumber}`}
        className="fixed inset-0 z-50 flex flex-col bg-white animate-in fade-in duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-brand-100 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-brand-900 truncate">
              {isQuoteMode
                ? `Vista previa de cotización - ${invoice.invoiceNumber}`
                : `Vista previa - ${invoice.controlNumber || invoice.invoiceNumber}`}
            </h2>
            <p className="text-xs text-brand-500">Pantalla completa · Esc para cerrar</p>
          </div>
          <button
            onClick={onClose}
            data-testid="btn-preview-close-x"
            className="p-1.5 rounded-lg text-brand-500 hover:text-brand-700 hover:bg-brand-100 transition-colors shrink-0"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — the document fills all the remaining window space */}
        <div className="relative flex-1 min-h-0 bg-gray-100 px-4 py-4">
          {loading && (
            <div className="flex items-center justify-center h-full text-brand-500">
              <svg
                className="animate-spin mr-2 h-5 w-5 text-brand-400"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              <span className="text-sm">Generando previsualización...</span>
            </div>
          )}

          {loadError && !loading && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-red-600">{loadError}</p>
            </div>
          )}

          {!loading && !loadError && previewHTML && (
            <iframe
              title="Vista previa del documento"
              data-testid="pdf-preview-frame"
              className="w-full h-full rounded-lg border border-brand-100 bg-white"
              srcDoc={previewHTML}
            />
          )}

          {adWaiting && (
            <div
              data-testid="desktop-ad-wait"
              className="absolute inset-0 z-10 flex flex-col rounded border border-brand-200 bg-white"
            >
              <iframe
                title="Anuncio"
                data-testid="desktop-ad-frame"
                className="min-h-0 flex-1 w-full rounded-t border-0"
                src={AD_CONFIG.desktop.DESKTOP_AD_LANDING_URL}
              />
              <div className="border-t border-brand-100 px-4 py-3">
                <p className="text-sm font-medium text-brand-800">Preparando envío de cotización</p>
                <p className="text-xs text-brand-500">
                  El correo se abrirá automáticamente en {adSecondsRemaining}s.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-brand-100 shrink-0">
          {footer}
        </div>
      </div>
    </>,
    document.body
  );
}

export default InvoicePDFPreview;
