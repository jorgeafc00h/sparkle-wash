/**
 * Product photos — the budgeted resizer and the photoUrl round-trip.
 *
 * The resizer exists because a product envelope over 16 KB decoded-gzip is
 * DROPPED by the sync flush (payload_too_large) — losing the whole edit. These
 * tests pin the iteration logic (quality ladder → smaller dimensions → hard
 * refusal) without a DOM, plus the slice behaviour that keeps photoUrl in sync
 * with addProduct/updateProduct/syncUpsertProduct.
 */

import {
  ImageBudgetExceededError,
  planResizeAttempts,
  PRODUCT_PHOTO_RESIZE_OPTIONS,
  resizeImageToDataUrl,
  type LoadedImage,
  type ResizeImageDeps,
  type ResizeImageOptions,
} from '../../services/images/resizeImage';
import reducer, {
  addProduct,
  updateProduct,
  syncUpsertProduct,
} from '../../store/slices/productSlice';
import { ProductState } from '../../types';
import { Product, UnitOfMeasure, TaxCategory, ProductStatus } from '../../types/product';

const options = (overrides: Partial<ResizeImageOptions> = {}): ResizeImageOptions => ({
  ...PRODUCT_PHOTO_RESIZE_OPTIONS,
  ...overrides,
});

// ── planResizeAttempts ───────────────────────────────────────────────────────

describe('planResizeAttempts', () => {
  it('caps the output at maxSidePx and keeps the aspect ratio', () => {
    const attempts = planResizeAttempts(1600, 1200, options());
    const first = attempts[0];
    expect(first).toEqual({ width: 320, height: 240, quality: 0.7 });
    for (const attempt of attempts) {
      expect(Math.max(attempt.width, attempt.height)).toBeLessThanOrEqual(320);
    }
  });

  it('walks the whole quality ladder before shrinking dimensions', () => {
    const attempts = planResizeAttempts(1000, 1000, options());
    const qualities = attempts.slice(0, 3).map((attempt) => attempt.quality);
    expect(qualities).toEqual([0.7, 0.5, 0.35]);
    // Second dimension round starts at 80% of the first.
    expect(attempts[3]).toEqual({ width: 256, height: 256, quality: 0.7 });
  });

  it('never plans a round below minSidePx', () => {
    const attempts = planResizeAttempts(4000, 4000, options());
    const smallestSide = Math.min(...attempts.map((attempt) => Math.max(attempt.width, attempt.height)));
    expect(smallestSide).toBeGreaterThanOrEqual(options().minSidePx);
  });

  it('does not upscale small images', () => {
    const attempts = planResizeAttempts(120, 80, options());
    expect(attempts[0]).toEqual({ width: 120, height: 80, quality: 0.7 });
  });

  it('always plans the first round even below minSidePx (small-but-heavy sources get encoded)', () => {
    // An 80x60 source below the 96px floor still gets one quality-ladder pass —
    // its data-URI may be over budget (tiny PNG with heavy metadata) while a
    // single JPEG re-encode fits. Refusing without an attempt is the bug.
    const attempts = planResizeAttempts(80, 60, options());
    expect(attempts).toEqual([
      { width: 80, height: 60, quality: 0.7 },
      { width: 80, height: 60, quality: 0.5 },
      { width: 80, height: 60, quality: 0.35 },
    ]);
  });
});

// ── resizeImageToDataUrl (injected encoder — no DOM) ────────────────────────

interface FakeImage extends LoadedImage {
  width: number;
  height: number;
}

/** Encoder whose output length tracks dimensions x quality — the shrink lever. */
function makeDeps(outputs: {
  naturalWidth: number;
  naturalHeight: number;
  bytesPerPixel: number;
  /** Length of the SOURCE data-URI the reader returns (over-budget small images). */
  sourceDataUrlChars?: number;
}): ResizeImageDeps & { attempts: Array<{ width: number; height: number; quality: number }> } {
  const recorded: Array<{ width: number; height: number; quality: number }> = [];
  const fake: LoadedImage = {
    width: outputs.naturalWidth,
    height: outputs.naturalHeight,
    drawTo: () => undefined,
  };
  return {
    attempts: recorded,
    readFileAsDataUrl: async () => `data:image/png;base64,${'a'.repeat(outputs.sourceDataUrlChars ?? 64)}`,
    loadImage: async () => fake,
    encodeToDataUrl: async (_image, width, height, quality) => {
      recorded.push({ width, height, quality });
      // data:image/jpeg;base64, prefix + payload proportional to area x quality.
      const payloadChars = Math.round(width * height * quality * outputs.bytesPerPixel);
      return `data:image/jpeg;base64,${'b'.repeat(Math.max(1, payloadChars))}`;
    },
  };
}

describe('resizeImageToDataUrl — budget enforcement', () => {
  const file = { type: 'image/png', size: 900_000 } as unknown as File;

  it('returns the first attempt that fits the byte budget', async () => {
    // 320x320 at q0.7 is over budget; q0.5 fits.
    const deps = makeDeps({ naturalWidth: 3200, naturalHeight: 3200, bytesPerPixel: 0.14 });
    const budget = options({ maxDataUrlChars: 30_000 });
    const result = await resizeImageToDataUrl(file, budget, deps);
    expect(deps.attempts).toEqual([{ width: 320, height: 320, quality: 0.7 }]);
    expect(result.width).toBe(320);
    expect(result.height).toBe(320);
    expect(result.dataUrl.length).toBeLessThanOrEqual(budget.maxDataUrlChars);
  });

  it('lowers dimensions only after exhausting the quality ladder', async () => {
    // bytesPerPixel 0.6: the whole 320px ladder overflows 20k; 256px@q0.5 fits.
    const deps = makeDeps({ naturalWidth: 3200, naturalHeight: 3200, bytesPerPixel: 0.6 });
    const budget = options({ maxDataUrlChars: 20_000 });
    const result = await resizeImageToDataUrl(file, budget, deps);
    // The whole first-round ladder (0.7/0.5/0.35 at 320) failed before shrinking.
    expect(deps.attempts.slice(0, 3)).toEqual([
      { width: 320, height: 320, quality: 0.7 },
      { width: 320, height: 320, quality: 0.5 },
      { width: 320, height: 320, quality: 0.35 },
    ]);
    expect(deps.attempts[3]).toEqual({ width: 256, height: 256, quality: 0.7 });
    expect(deps.attempts[4]).toEqual({ width: 256, height: 256, quality: 0.5 });
    expect(result.width).toBe(256);
    expect(result.dataUrl.length).toBeLessThanOrEqual(budget.maxDataUrlChars);
  });

  it('keeps trying smaller dimensions until the floor, then refuses (never stores an oversized image)', async () => {
    const deps = makeDeps({ naturalWidth: 3200, naturalHeight: 3200, bytesPerPixel: 5 });
    const budget = options({ maxDataUrlChars: 2_000 });
    await expect(resizeImageToDataUrl(file, budget, deps)).rejects.toBeInstanceOf(ImageBudgetExceededError);
    // Every planned attempt was tried before giving up.
    const planned = planResizeAttempts(3200, 3200, budget);
    expect(deps.attempts.length).toBe(planned.length);
  });

  it('refuses without leaking internal budget numbers (RN-parity copy)', () => {
    const error = new ImageBudgetExceededError();
    expect(error.message).toBe('No se pudo reducir la foto lo suficiente. Prueba con una imagen más simple.');
  });

  it('re-encodes a small-dimension source whose data-URI is over budget (no premature refusal)', async () => {
    // 80x60 PNG whose raw data-URI is 20k chars: below the 96px floor but over
    // the 12k budget — the first-round ladder must still run and fit.
    const deps = makeDeps({ naturalWidth: 80, naturalHeight: 60, bytesPerPixel: 3, sourceDataUrlChars: 20_000 });
    const result = await resizeImageToDataUrl(file, options(), deps);
    expect(deps.attempts).toEqual([{ width: 80, height: 60, quality: 0.7 }]);
    expect(result.width).toBe(80);
    expect(result.height).toBe(60);
    expect(result.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(result.dataUrl.length).toBeLessThanOrEqual(options().maxDataUrlChars);
  });

  it('rejects a zero-natural-size image (e.g. an SVG without intrinsic dimensions)', async () => {
    const deps = makeDeps({ naturalWidth: 0, naturalHeight: 0, bytesPerPixel: 0.1 });
    await expect(resizeImageToDataUrl(file, options(), deps)).rejects.toThrow('Archivo de imagen inválido');
    expect(deps.attempts).toHaveLength(0);
  });

  it('returns a small source verbatim — no recompression', async () => {
    const smallDataUrl = `data:image/png;base64,${'c'.repeat(200)}`;
    const image: LoadedImage = { width: 100, height: 60, drawTo: () => undefined };
    let encoded = false;
    const deps: ResizeImageDeps = {
      readFileAsDataUrl: async () => smallDataUrl,
      loadImage: async () => image,
      encodeToDataUrl: async () => {
        encoded = true;
        return 'data:image/jpeg;base64,xxxx';
      },
    };
    const result = await resizeImageToDataUrl(file, options(), deps);
    expect(result).toEqual({ dataUrl: smallDataUrl, width: 100, height: 60 });
    expect(encoded).toBe(false);
  });

  it('recompresses an in-budget-but-oversized-dimension image (dimension cap applies too)', async () => {
    // A 1_000 px PNG whose data-URI is short: fits the budget but exceeds maxSidePx.
    const deps = makeDeps({ naturalWidth: 1000, naturalHeight: 500, bytesPerPixel: 0.01 });
    const result = await resizeImageToDataUrl(file, options({ maxDataUrlChars: 500_000 }), deps);
    expect(result.width).toBe(320);
    expect(result.height).toBe(160);
    expect(deps.attempts.length).toBe(1);
  });
});

// ── photoUrl round-trip through the slice ───────────────────────────────────

const photoDataUrl = `data:image/jpeg;base64,${'Z'.repeat(512)}`;

const baseProduct = (overrides: Partial<Product> = {}): Product => ({
  id: 'prod_photo',
  productName: 'Café de El Salvador',
  unitPrice: 9.5,
  unitOfMeasure: UnitOfMeasure.UNIDAD,
  taxCategory: TaxCategory.GRAVADO,
  status: ProductStatus.Active,
  companyId: 'co1',
  isActive: true,
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z',
  ...overrides,
});

const initialState: ProductState = {
  products: [],
  stockMovements: [],
  categories: [],
  brands: [],
  suppliers: [],
  currentProduct: null,
  loading: false,
  error: null,
  searchTerm: '',
  filters: {},
};

describe('product photoUrl round-trip', () => {
  it('survives addProduct and normalizeProduct (spread keeps unknown-to-stock fields)', () => {
    const state = reducer(initialState, addProduct(baseProduct({ photoUrl: photoDataUrl })));
    expect(state.products[0].photoUrl).toBe(photoDataUrl);
  });

  it('updateProduct replaces the photo, and an undefined photoUrl removes it', () => {
    let state = reducer(initialState, addProduct(baseProduct({ photoUrl: photoDataUrl })));

    const newPhoto = `data:image/jpeg;base64,${'Y'.repeat(256)}`;
    state = reducer(state, updateProduct(baseProduct({ photoUrl: newPhoto })));
    expect(state.products[0].photoUrl).toBe(newPhoto);

    // Removal: the form saves photoUrl: undefined (the key disappears once serialized).
    state = reducer(state, updateProduct({ ...baseProduct(), photoUrl: undefined }));
    expect(state.products[0].photoUrl).toBeUndefined();
  });

  it('syncUpsertProduct applies a remote photo verbatim and drops it when absent', () => {
    let state = reducer(initialState, syncUpsertProduct(baseProduct({ photoUrl: photoDataUrl })));
    expect(state.products[0].photoUrl).toBe(photoDataUrl);

    // Peer edit without a photo: whole-product replacement removes the local copy.
    state = reducer(state, syncUpsertProduct(baseProduct({
      updatedAt: '2026-09-30T01:00:00.000Z',
    })));
    expect(state.products[0].photoUrl).toBeUndefined();
  });
});
