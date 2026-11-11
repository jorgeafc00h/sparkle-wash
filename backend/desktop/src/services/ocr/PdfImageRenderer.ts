// PdfImageRenderer — renders a PDF document to an array of PNG data URLs,
// one per page. Used by the compras OCR flow so the existing image
// extraction path handles both pure-image inputs and PDF invoices uniformly.
//
// Uses `pdfjs-dist`. We import the legacy build (`/legacy/build/pdf.mjs`)
// because it ships a worker that doesn't rely on `import.meta.url`
// resolution — important because the Electron renderer under the `app://`
// protocol resolves URLs differently from a normal http origin and the
// modern build's worker fails to load. We disable the worker entirely
// (`disableWorker: true`) to keep things simple; the renderer is single-
// threaded but we typically render only a few pages per invoice.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLibPromise: Promise<any> | null = null;

async function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
      // Disable the dedicated worker — see comment above.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mod as any).GlobalWorkerOptions.workerSrc = '';
      return mod;
    })();
  }
  return pdfjsLibPromise;
}

export interface PdfRenderOptions {
  /** Cap the number of pages we send to the OCR model. Most invoices fit on
   *  a single page; capping keeps latency + cost bounded for accidental
   *  multi-page uploads. */
  maxPages?: number;
  /** Render scale relative to the page's PDF size. 2.0 ≈ 144 DPI which is
   *  a good balance between OCR fidelity and base64 payload size. */
  scale?: number;
}

export interface PdfRenderResult {
  /** PNG data URLs, one per rendered page. */
  pages: string[];
  /** Total number of pages in the PDF (may exceed `pages.length` when
   *  `maxPages` was applied — useful for showing a "page 1 of N" hint). */
  totalPages: number;
}

/** Render a PDF (provided as ArrayBuffer or Uint8Array) to one PNG per page. */
export async function renderPdfToImages(
  pdfBytes: ArrayBuffer | Uint8Array,
  options: PdfRenderOptions = {},
): Promise<PdfRenderResult> {
  const { maxPages = 4, scale = 2.0 } = options;
  const pdfjs = await loadPdfjs();
  // pdfjs mutates the passed buffer; clone defensively.
  const data = pdfBytes instanceof Uint8Array ? new Uint8Array(pdfBytes) : new Uint8Array(pdfBytes);
  const loadingTask = pdfjs.getDocument({
    data,
    // Fully self-contained — no remote fonts, no worker.
    isEvalSupported: false,
    disableFontFace: false,
  });
  const pdfDoc = await loadingTask.promise;
  const totalPages: number = pdfDoc.numPages;
  const pageCount = Math.min(maxPages, totalPages);
  const pages: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('No se pudo obtener contexto 2D del canvas para renderizar PDF.');
    }
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    pages.push(canvas.toDataURL('image/png'));
    // Free page-level resources promptly — multi-page renders accumulate
    // a lot of decoded glyph data otherwise.
    page.cleanup();
  }

  // Free document-level resources.
  await pdfDoc.cleanup();

  return { pages, totalPages };
}
