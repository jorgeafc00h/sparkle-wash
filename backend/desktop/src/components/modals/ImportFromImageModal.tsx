// ImportFromImageModal — multi-format invoice importer for Compras.
//
// Accepts images (PNG / JPG / WEBP / HEIC), PDFs, and Costa-Rica
// FacturaElectronica v4.4 XMLs in the same picker. Each file is dispatched
// to the right pipeline:
//   - image → OCR via PurchaseOcrService (Azure OpenAI or Ollama)
//   - PDF   → render each page to PNG via PdfImageRenderer, then OCR
//             (per page) and merge the resulting items / totals
//   - XML   → CostaRicaXmlParser (no OCR call, confidence 1.0)
//
// All paths converge on the same `ExtractedPurchase` shape so the user
// reviews + edits + saves identically regardless of source.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FileText,
  FileCode2,
  Image as ImageIcon,
  Loader2,
  Check,
  X,
  AlertCircle,
} from 'lucide-react';
import { nanoid } from '@reduxjs/toolkit';

import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { useToast } from '@/components/common/Toast';

import {
  PurchaseOcrService,
  type ExtractedPurchase,
} from '@/services/ocr/PurchaseOcrService';
import { OcrSettingsService } from '@/services/ocr/OcrSettingsService';
import { renderPdfToImages } from '@/services/ocr/PdfImageRenderer';
import { parseCostaRicaInvoiceXml } from '@/services/ocr/CostaRicaXmlParser';
import { ComprasDatabase } from '@/services/compras/ComprasDatabase';
import { CompraSource, type Compra, type CompraItem } from '@/types/compras';

interface ImportFromImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  /** Called after at least one row is saved so the parent can refresh. */
  onImported?: (count: number) => void;
}

type SourceKind = 'image' | 'pdf' | 'xml' | 'unknown';

type ItemState =
  | { status: 'pending'; file: File; kind: SourceKind; previewUrl: string }
  | {
      status: 'extracting';
      file: File;
      kind: SourceKind;
      previewUrl: string;
      stage?: string;
    }
  | {
      status: 'ready';
      file: File;
      kind: SourceKind;
      previewUrl: string;
      data: ExtractedPurchase;
      include: boolean;
    }
  | {
      status: 'error';
      file: File;
      kind: SourceKind;
      previewUrl: string;
      error: string;
    };

interface ImportRow {
  id: string;
  state: ItemState;
}

// ── File-classification helpers ──────────────────────────────────────────────

function detectKind(file: File): SourceKind {
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.includes('xml') || name.endsWith('.xml')) return 'xml';
  if (/\.(png|jpe?g|webp|heic|heif|gif|bmp)$/.test(name)) return 'image';
  return 'unknown';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Lectura de archivo inválida'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Error de lectura'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Lectura de archivo inválida'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Error de lectura'));
    reader.readAsText(file);
  });
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('Lectura de archivo inválida'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Error de lectura'));
    reader.readAsArrayBuffer(file);
  });
}

function inferTipoDte(documentType: ExtractedPurchase['documentType']): string {
  // Map the model's coarse classification into the MH tipoDte codes Compras
  // already uses. 'ticket' has no native MH mapping — store as Factura ("01")
  // for accounting purposes.
  switch (documentType) {
    case 'ccf':
      return '03';
    case 'factura':
    case 'ticket':
      return '01';
    default:
      return '01';
  }
}

function buildCompraFromExtraction(
  extracted: ExtractedPurchase,
  companyId: string,
): Compra {
  const compraId = `compra_${nanoid(10)}`;
  const now = new Date().toISOString();
  const items: CompraItem[] = extracted.items.map((it, idx) => ({
    id: `compraitem_${nanoid(10)}`,
    compraId,
    numItem: idx + 1,
    descripcion: it.description || `Item ${idx + 1}`,
    cantidad: it.quantity || 0,
    precioUni: it.unitPrice || 0,
    ventaGravada: it.total || 0,
  }));

  return {
    id: compraId,
    companyId,
    emisorNit: extracted.vendor?.nit ?? '',
    emisorNrc: extracted.vendor?.nrc || undefined,
    emisorNombre: extracted.vendor?.name ?? '',
    tipoDte: inferTipoDte(extracted.documentType),
    codigoGeneracion: extracted.codigoGeneracion || '',
    numeroControl: extracted.documentNumber || '',
    fecha: extracted.date || now.slice(0, 10),
    totalGravada: extracted.subtotal || 0,
    totalIva: extracted.iva || 0,
    totalPagar: extracted.total || 0,
    source: CompraSource.OCR,
    items,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Combine OCR results across multiple PDF pages into a single
 * `ExtractedPurchase`. Heuristic: keep page-1 metadata (vendor, dates,
 * doc number) since that's where invoice headers live, append items from
 * subsequent pages, and recompute totals as the max-confidence values.
 */
function mergePagesToSinglePurchase(
  pages: ExtractedPurchase[],
): ExtractedPurchase {
  if (pages.length === 0) {
    return {
      documentType: 'otro',
      vendor: { name: '', nit: '', nrc: '' },
      documentNumber: '',
      codigoGeneracion: '',
      date: '',
      subtotal: 0,
      iva: 0,
      total: 0,
      items: [],
      confidence: 0,
    };
  }
  if (pages.length === 1) return pages[0];
  const head = pages[0];
  const allItems = pages.flatMap((p) => p.items);
  // Sum totals across pages — most multi-page invoices repeat the grand
  // total only on the last page, but per-page subtotals are common.
  const subtotal = pages.reduce((sum, p) => sum + (p.subtotal || 0), 0);
  const iva = pages.reduce((sum, p) => sum + (p.iva || 0), 0);
  // Prefer the highest reported total (likely the final-page grand total)
  // over a sum (which would double-count repeat headers).
  const total = pages.reduce((max, p) => Math.max(max, p.total || 0), 0);
  const confidence =
    pages.reduce((sum, p) => sum + (p.confidence || 0), 0) / pages.length;
  return {
    ...head,
    subtotal: subtotal || head.subtotal,
    iva: iva || head.iva,
    total: total || head.total,
    items: allItems,
    confidence,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function ImportFromImageModal({
  isOpen,
  onClose,
  companyId,
  onImported,
}: ImportFromImageModalProps) {
  const toast = useToast();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [hasConfig, setHasConfig] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Probe config the first time the modal renders. We don't open the
  // settings page here — the user has a clear hint + link below. The
  // active provider determines which fields need to be filled, so we read
  // the full settings bundle and treat the active block as the gate.
  // XML imports don't need an OCR config so the modal stays usable even
  // when nothing is configured (see `requiresOcrConfig` further down).
  const probeConfig = useCallback(async () => {
    const settings = await OcrSettingsService.getSettings();
    if (settings.provider === 'ollama') {
      setHasConfig(!!settings.ollama.baseUrl && !!settings.ollama.model);
    } else {
      setHasConfig(!!settings.azure.endpoint && !!settings.azure.apiKey);
    }
  }, []);

  // Trigger the picker via electronAPI when available (multi-select native
  // dialog with a file filter), else fall back to the hidden <input>.
  const handlePick = useCallback(async () => {
    setBusy(true);
    try {
      const api = window.electronAPI;
      const files: File[] = [];
      if (api?.showOpenDialog && api.readFile) {
        const paths = await api.showOpenDialog({
          title: 'Selecciona facturas (imágenes, PDFs o XMLs)',
          filters: [
            {
              name: 'Facturas',
              extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic', 'pdf', 'xml'],
            },
            { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic'] },
            { name: 'PDF', extensions: ['pdf'] },
            { name: 'XML', extensions: ['xml'] },
          ],
          properties: ['openFile', 'multiSelections'],
        });
        if (paths && paths.length > 0) {
          // Read each file as base64 via the main process — keeps a single
          // code path for File-shaped consumption regardless of MIME type.
          for (const p of paths) {
            const base64 = await api.readFile(p, 'base64');
            const ext = (p.split('.').pop() ?? '').toLowerCase();
            const mime = mimeForExtension(ext);
            const blob = await (await fetch(`data:${mime};base64,${base64}`)).blob();
            const file = new File([blob], p.split('/').pop() ?? `file.${ext}`, {
              type: mime,
            });
            files.push(file);
          }
        }
      } else {
        fileInputRef.current?.click();
        setBusy(false);
        return;
      }
      await ingestFiles(files);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo abrir el diálogo');
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const ingestFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const newRows: ImportRow[] = await Promise.all(
      files.map(async (f) => {
        const kind = detectKind(f);
        // For images we use the file's data URL as the inline preview.
        // For PDFs / XMLs we use a kind-specific placeholder data URL since
        // the renderer can't display those tags inline without extra deps.
        let previewUrl = '';
        if (kind === 'image') {
          try {
            previewUrl = await readFileAsDataUrl(f);
          } catch {
            previewUrl = '';
          }
        }
        return {
          id: nanoid(8),
          state: { status: 'pending' as const, file: f, kind, previewUrl },
        };
      }),
    );
    setRows((prev) => [...prev, ...newRows]);
    void runIngestion(newRows);
  }, []);

  /**
   * Dispatch each row to its correct pipeline. Sequential — Azure OpenAI
   * rate-limits aggressively at lower tiers and the renderer is single-
   * threaded for canvas rendering anyway.
   */
  const runIngestion = useCallback(async (target: ImportRow[]) => {
    // Probe config ONCE for the whole batch. We only block image / PDF rows
    // when the OCR provider isn't configured — XML rows can still parse.
    const settings = await OcrSettingsService.getSettings();
    const ocrConfigured =
      settings.provider === 'ollama'
        ? !!settings.ollama.baseUrl && !!settings.ollama.model
        : !!settings.azure.endpoint && !!settings.azure.apiKey;
    setHasConfig(ocrConfigured);

    for (const row of target) {
      const { kind } = row.state;
      if ((kind === 'image' || kind === 'pdf') && !ocrConfigured) {
        setRowError(
          row.id,
          'No hay proveedor de OCR configurado. Configura Azure OpenAI o Ollama en Configuración → Compras.',
        );
        continue;
      }
      try {
        if (kind === 'image') {
          await processImageRow(row);
        } else if (kind === 'pdf') {
          await processPdfRow(row);
        } else if (kind === 'xml') {
          await processXmlRow(row);
        } else {
          setRowError(
            row.id,
            `Tipo de archivo no soportado: ${row.state.file.name}. Usa imagen, PDF o XML.`,
          );
        }
      } catch (err) {
        setRowError(row.id, err instanceof Error ? err.message : 'Error desconocido');
      }
    }
  }, []);

  // ── Per-kind handlers ──────────────────────────────────────────────────────

  async function processImageRow(row: ImportRow) {
    const { file, kind, previewUrl } = row.state;
    setRowExtracting(row.id, kind, file, previewUrl, 'Extrayendo datos…');
    const dataUrl = previewUrl || (await readFileAsDataUrl(file));
    const result = await PurchaseOcrService.extractFromImage(dataUrl);
    if (result.ok && result.data) {
      setRowReady(row.id, kind, file, dataUrl, result.data);
    } else {
      setRowError(row.id, result.error || 'Error desconocido');
    }
  }

  async function processPdfRow(row: ImportRow) {
    const { file, kind } = row.state;
    setRowExtracting(row.id, kind, file, '', 'Renderizando páginas del PDF…');
    const buffer = await readFileAsArrayBuffer(file);
    const { pages, totalPages } = await renderPdfToImages(buffer, { maxPages: 4 });
    if (pages.length === 0) {
      setRowError(row.id, 'PDF vacío o no se pudieron renderizar páginas.');
      return;
    }
    // Use the first rendered page as the preview thumbnail so the row card
    // shows something familiar (like an image row).
    const preview = pages[0];
    const pageResults: ExtractedPurchase[] = [];
    for (let i = 0; i < pages.length; i++) {
      setRowExtracting(
        row.id,
        kind,
        file,
        preview,
        `Extrayendo página ${i + 1}/${pages.length}${pages.length < totalPages ? ' (PDF completo: ' + totalPages + ' páginas)' : ''}…`,
      );
      const result = await PurchaseOcrService.extractFromImage(pages[i]);
      if (result.ok && result.data) {
        pageResults.push(result.data);
      } else if (i === 0) {
        // First-page failure is fatal — without the header data we can't
        // construct a sensible Compra.
        setRowError(row.id, result.error || 'Error al extraer la primera página.');
        return;
      }
      // Per-page failures past page 1 just lose those items.
    }
    setRowReady(row.id, kind, file, preview, mergePagesToSinglePurchase(pageResults));
  }

  async function processXmlRow(row: ImportRow) {
    const { file, kind } = row.state;
    setRowExtracting(row.id, kind, file, '', 'Parseando XML…');
    const text = await readFileAsText(file);
    const result = parseCostaRicaInvoiceXml(text);
    if (result.ok && result.data) {
      setRowReady(row.id, kind, file, '', result.data);
    } else {
      setRowError(row.id, result.error || 'XML no soportado.');
    }
  }

  // ── Row state mutators ─────────────────────────────────────────────────────

  function setRowExtracting(
    rowId: string,
    kind: SourceKind,
    file: File,
    previewUrl: string,
    stage: string,
  ) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, state: { status: 'extracting', kind, file, previewUrl, stage } }
          : r,
      ),
    );
  }

  function setRowReady(
    rowId: string,
    kind: SourceKind,
    file: File,
    previewUrl: string,
    data: ExtractedPurchase,
  ) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              state: {
                status: 'ready',
                kind,
                file,
                previewUrl,
                data,
                include: true,
              },
            }
          : r,
      ),
    );
  }

  function setRowError(rowId: string, error: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const { file, kind, previewUrl } = r.state;
        return {
          ...r,
          state: { status: 'error', file, kind, previewUrl: previewUrl ?? '', error },
        };
      }),
    );
  }

  // ── Other actions ──────────────────────────────────────────────────────────

  const updateField = useCallback(
    (rowId: string, mutator: (data: ExtractedPurchase) => ExtractedPurchase) => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== rowId || r.state.status !== 'ready') return r;
          return {
            ...r,
            state: { ...r.state, data: mutator(r.state.data) },
          };
        }),
      );
    },
    [],
  );

  const removeRow = useCallback((rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  }, []);

  const toggleInclude = useCallback((rowId: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId || r.state.status !== 'ready') return r;
        return { ...r, state: { ...r.state, include: !r.state.include } };
      }),
    );
  }, []);

  const readyRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.state.status === 'ready' && (r.state as { include: boolean }).include,
      ),
    [rows],
  );

  const handleSave = useCallback(async () => {
    if (readyRows.length === 0) {
      toast.error('Selecciona al menos una factura para guardar.');
      return;
    }
    setBusy(true);
    let saved = 0;
    try {
      for (const r of readyRows) {
        if (r.state.status !== 'ready') continue;
        const compra = buildCompraFromExtraction(r.state.data, companyId);
        // Stash a small reference to the source so the user can review it
        // later. For images / PDFs that's the rendered preview data URL;
        // for XML we drop the raw XML text into the same field (the UI
        // currently treats it as opaque).
        compra.ocrImageUri = r.state.previewUrl || undefined;
        await ComprasDatabase.insertCompra(compra);
        saved++;
      }
      toast.success(
        `${saved} compra${saved === 1 ? '' : 's'} agregada${saved === 1 ? '' : 's'}.`,
      );
      onImported?.(saved);
      setRows([]);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setBusy(false);
    }
  }, [readyRows, companyId, onClose, onImported, toast]);

  // Probe config when the modal opens.
  if (isOpen && hasConfig === null) {
    void probeConfig();
  }

  // The picker / OCR-required hint only blocks image + PDF imports — XML
  // imports work without any provider configured. We surface the warning
  // but keep the picker enabled so a user can still drop an XML.
  const requiresOcrConfig = hasConfig === false;

  const footer = (
    <div className="flex items-center gap-2 w-full">
      {rows.length > 0 && (
        <span className="text-xs text-brand-500 mr-auto">
          {readyRows.length} de {rows.length} listas para guardar
        </span>
      )}
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Cancelar
      </Button>
      <Button
        variant="primary"
        onClick={handleSave}
        disabled={busy || readyRows.length === 0}
        loading={busy}
      >
        Guardar {readyRows.length > 0 ? `(${readyRows.length})` : ''}
      </Button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Importar facturas (imagen, PDF o XML)"
      size="lg"
      footer={footer}
    >
      <div className="space-y-4">
        {requiresOcrConfig && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">Configuración de OCR requerida</p>
              <p>
                Configura un proveedor (Azure OpenAI o Ollama local) en{' '}
                <strong>Configuración de Compras → OCR de facturas</strong>{' '}
                para extraer datos de imágenes o PDFs. Los archivos XML de
                Costa Rica se importan sin necesidad de OCR.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            icon={<ImageIcon size={16} />}
            onClick={handlePick}
            disabled={busy}
            data-testid="btn-pick-images"
          >
            Seleccionar archivos
          </Button>
          <span className="text-xs text-brand-400">
            Soporta JPG, PNG, WEBP, HEIC, PDF y XML (Costa Rica v4.4)
          </span>
          {/* Hidden fallback input — used when running outside Electron. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,.pdf,.xml,text/xml"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) void ingestFiles(files);
              e.target.value = '';
            }}
          />
        </div>

        {rows.length === 0 ? (
          <div className="text-center py-10 text-brand-400 text-sm">
            No hay archivos cargados. Selecciona facturas o tickets en formato
            imagen, PDF o XML.
          </div>
        ) : (
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {rows.map((r) => (
              <RowCard
                key={r.id}
                row={r}
                onRemove={() => removeRow(r.id)}
                onToggle={() => toggleInclude(r.id)}
                onChange={(mut) => updateField(r.id, mut)}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Row card ─────────────────────────────────────────────────────────────────

interface RowCardProps {
  row: ImportRow;
  onRemove: () => void;
  onToggle: () => void;
  onChange: (mutator: (data: ExtractedPurchase) => ExtractedPurchase) => void;
}

function RowCard({ row, onRemove, onToggle, onChange }: RowCardProps) {
  const { state } = row;
  const fileName = state.file.name;
  const kindIcon =
    state.kind === 'pdf' ? (
      <FileText size={20} className="text-red-500" />
    ) : state.kind === 'xml' ? (
      <FileCode2 size={20} className="text-violet-500" />
    ) : (
      <ImageIcon size={20} className="text-brand-400" />
    );
  return (
    <div className="rounded-lg border border-brand-200 bg-white p-3 flex gap-3">
      {state.previewUrl ? (
        <img
          src={state.previewUrl}
          alt={fileName}
          className="w-24 h-24 object-cover rounded border border-brand-100 shrink-0"
        />
      ) : (
        <div className="w-24 h-24 rounded border border-brand-100 shrink-0 flex flex-col items-center justify-center bg-brand-50 text-brand-400">
          {kindIcon}
          <span className="text-[10px] mt-1 uppercase tracking-wide">
            {state.kind === 'xml' ? 'XML' : state.kind === 'pdf' ? 'PDF' : 'Archivo'}
          </span>
        </div>
      )}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-start gap-2">
          <p className="text-sm font-medium text-brand-800 truncate flex-1">
            {fileName}
          </p>
          <button
            type="button"
            onClick={onRemove}
            className="text-brand-400 hover:text-red-500 p-1"
            aria-label="Quitar"
          >
            <X size={14} />
          </button>
        </div>

        {state.status === 'pending' && (
          <p className="text-xs text-brand-500">Pendiente…</p>
        )}
        {state.status === 'extracting' && (
          <p className="text-xs text-accent-600 flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />{' '}
            {state.stage ?? 'Extrayendo datos…'}
          </p>
        )}
        {state.status === 'error' && (
          <p className="text-xs text-red-600 flex items-start gap-1">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span>{state.error}</span>
          </p>
        )}
        {state.status === 'ready' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1 text-brand-700">
                <input
                  type="checkbox"
                  checked={state.include}
                  onChange={onToggle}
                />
                Incluir al guardar
              </label>
              <span className="text-brand-400">·</span>
              <span className="text-brand-500">
                Confianza:{' '}
                <strong className="text-brand-700">
                  {Math.round((state.data.confidence ?? 0) * 100)}%
                </strong>
              </span>
              {state.kind === 'xml' && (
                <>
                  <span className="text-brand-400">·</span>
                  <span className="text-violet-600 font-medium">XML estructurado</span>
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Proveedor"
                value={state.data.vendor.name}
                onChange={(e) =>
                  onChange((d) => ({
                    ...d,
                    vendor: { ...d.vendor, name: e.target.value },
                  }))
                }
              />
              <Input
                label="NIT / Cédula"
                value={state.data.vendor.nit}
                onChange={(e) =>
                  onChange((d) => ({
                    ...d,
                    vendor: { ...d.vendor, nit: e.target.value },
                  }))
                }
              />
              <Input
                label="N° Documento"
                value={state.data.documentNumber}
                onChange={(e) =>
                  onChange((d) => ({ ...d, documentNumber: e.target.value }))
                }
              />
              <Input
                label="Fecha (YYYY-MM-DD)"
                value={state.data.date}
                onChange={(e) => onChange((d) => ({ ...d, date: e.target.value }))}
              />
              <Input
                label="Subtotal"
                type="number"
                value={String(state.data.subtotal)}
                onChange={(e) =>
                  onChange((d) => ({
                    ...d,
                    subtotal: parseFloat(e.target.value) || 0,
                  }))
                }
              />
              <Input
                label="IVA"
                type="number"
                value={String(state.data.iva)}
                onChange={(e) =>
                  onChange((d) => ({ ...d, iva: parseFloat(e.target.value) || 0 }))
                }
              />
              <Input
                label="Total"
                type="number"
                value={String(state.data.total)}
                onChange={(e) =>
                  onChange((d) => ({ ...d, total: parseFloat(e.target.value) || 0 }))
                }
              />
              <Input
                label="Tipo"
                value={state.data.documentType}
                onChange={(e) =>
                  onChange((d) => ({
                    ...d,
                    documentType: e.target.value as ExtractedPurchase['documentType'],
                  }))
                }
              />
            </div>
            {state.data.items.length > 0 && (
              <p className="text-xs text-brand-500 flex items-center gap-1">
                <Check size={12} className="text-green-600" />
                {state.data.items.length} ítem(s) extraído(s)
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mimeForExtension(ext: string): string {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'heic':
    case 'heif':
      return 'image/heic';
    case 'pdf':
      return 'application/pdf';
    case 'xml':
      return 'application/xml';
    case 'png':
    default:
      return `image/${ext || 'png'}`;
  }
}

export default ImportFromImageModal;
