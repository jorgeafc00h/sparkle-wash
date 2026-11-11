// Canvas image resizer with a STRICT byte budget.
//
// Product photos ride the Device Sync v2 product envelope (serializeForWire passes
// the whole product), and the relay caps every envelope at 16 KB decoded-gzip —
// payloadCodec throws PayloadTooLargeError above that and flush DROPS the payload
// (data loss, `payload_too_large` in the outbox). So the resizer never returns a
// data-URI larger than its budget: it walks a quality ladder (0.7 → 0.5 → 0.35)
// at the target size, then shrinks the dimensions and walks the ladder again,
// until an encode fits. The CompanyConfigPage logo resizer (600 px side, no byte
// budget) stays where it is — logos never leave the device
// (COMPANY_DEVICE_LOCAL_FIELDS), so they don't need this constraint.

/** Budget the data-URI (base64 string) itself must fit in. */
export interface ResizeImageOptions {
  /** Cap for the longest side of the output, in CSS pixels. */
  maxSidePx: number;
  /** HARD ceiling on the returned data-URI's character length. */
  maxDataUrlChars: number;
  /** JPEG qualities tried per dimension round, best first. */
  qualityLadder: readonly number[];
  /** Dimension rounds stop once the longest side would fall below this floor. */
  minSidePx: number;
  /** Multiplier applied to the dimensions between rounds (0 < factor < 1). */
  shrinkFactor: number;
}

/** Product photos: ~12 KB leaves headroom for the rest of the envelope under the 16 KB relay cap. */
export const PRODUCT_PHOTO_MAX_DATA_URL_CHARS = 12_000;

export const PRODUCT_PHOTO_RESIZE_OPTIONS: ResizeImageOptions = {
  maxSidePx: 320,
  maxDataUrlChars: PRODUCT_PHOTO_MAX_DATA_URL_CHARS,
  qualityLadder: [0.7, 0.5, 0.35],
  minSidePx: 96,
  shrinkFactor: 0.8,
};

/** One encode attempt: output dimensions + JPEG quality. */
export interface ResizeAttempt {
  width: number;
  height: number;
  quality: number;
}

export class ImageBudgetExceededError extends Error {
  constructor() {
    // Same wording as the RN app's "too large" alert — no internal budget numbers.
    super('No se pudo reducir la foto lo suficiente. Prueba con una imagen más simple.');
    this.name = 'ImageBudgetExceededError';
  }
}

/**
 * Pure planning: every (dimensions, quality) attempt in the order the resizer
 * tries them. Separated from the canvas execution so the iteration logic is
 * unit-testable without a DOM.
 */
export function planResizeAttempts(
  naturalWidth: number,
  naturalHeight: number,
  options: ResizeImageOptions,
): ResizeAttempt[] {
  const ratio = Math.min(1, options.maxSidePx / Math.max(naturalWidth, naturalHeight, 1));
  const attempts: ResizeAttempt[] = [];

  let width = Math.max(1, Math.round(naturalWidth * ratio));
  let height = Math.max(1, Math.round(naturalHeight * ratio));

  // The FIRST round always runs at the initial (never-upscaled) size, even when
  // it is below minSidePx: a small-dimension source whose data-URI is over
  // budget (e.g. a tiny PNG carrying heavy metadata) still deserves one pass of
  // the quality ladder — refusing without a single encode would reject photos
  // the RN pipeline (same budget, encode-first) accepts.
  for (
    let guard = 0;
    guard < 32 && (guard === 0 || Math.max(width, height) >= options.minSidePx);
    guard += 1
  ) {
    for (const quality of options.qualityLadder) {
      attempts.push({ width, height, quality });
    }
    width = Math.max(1, Math.floor(width * options.shrinkFactor));
    height = Math.max(1, Math.floor(height * options.shrinkFactor));
  }

  return attempts;
}

/** Decoded image the executor works with — the DOM default wraps an <img> element. */
export interface LoadedImage {
  width: number;
  height: number;
  drawTo(canvas: HTMLCanvasElement): void;
}

export interface ResizeImageDeps {
  /** Reads the picked File into a data-URI (FileReader). */
  readFileAsDataUrl(file: File): Promise<string>;
  /** Decodes a data-URI and reports its natural size. */
  loadImage(src: string): Promise<LoadedImage>;
  /** Draws the image onto a canvas of the given size and encodes it as JPEG. */
  encodeToDataUrl(image: LoadedImage, width: number, height: number, quality: number): Promise<string>;
}

const domDeps: ResizeImageDeps = {
  readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsDataURL(file);
    });
  },
  loadImage(src) {
    return new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () =>
        resolve({
          width: el.naturalWidth,
          height: el.naturalHeight,
          drawTo(canvas) {
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas no disponible');
            ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
          },
        });
      el.onerror = () => reject(new Error('Archivo de imagen inválido'));
      el.src = src;
    });
  },
  async encodeToDataUrl(image, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    image.drawTo(canvas);
    return canvas.toDataURL('image/jpeg', quality);
  },
};

export interface ResizeImageResult {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Resizes an image file to a data-URI that ALWAYS fits `options.maxDataUrlChars`
 * (or throws ImageBudgetExceededError). A source that already fits both the size
 * and byte budget is returned verbatim — no recompression.
 */
export async function resizeImageToDataUrl(
  file: File,
  options: ResizeImageOptions = PRODUCT_PHOTO_RESIZE_OPTIONS,
  deps: ResizeImageDeps = domDeps,
): Promise<ResizeImageResult> {
  const src = await deps.readFileAsDataUrl(file);
  const image = await deps.loadImage(src);
  // Pathological decode — e.g. an SVG without intrinsic dimensions reports
  // naturalWidth/Height 0: refuse rather than encode a 1x1 pixel.
  if (
    !Number.isFinite(image.width) || !Number.isFinite(image.height) ||
    image.width < 1 || image.height < 1
  ) {
    throw new Error('Archivo de imagen inválido');
  }

  // Small enough already: keep the original bytes (preserves PNG transparency).
  if (
    src.length <= options.maxDataUrlChars &&
    Math.max(image.width, image.height) <= options.maxSidePx
  ) {
    return { dataUrl: src, width: image.width, height: image.height };
  }

  for (const attempt of planResizeAttempts(image.width, image.height, options)) {
    const dataUrl = await deps.encodeToDataUrl(image, attempt.width, attempt.height, attempt.quality);
    if (dataUrl.length <= options.maxDataUrlChars) {
      return { dataUrl, width: attempt.width, height: attempt.height };
    }
  }

  // Never return an over-budget image: a payload_too_large envelope is DROPPED
  // by the sync flush, which would silently lose the whole product edit.
  throw new ImageBudgetExceededError();
}
