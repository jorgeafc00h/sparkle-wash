/**
 * Device Sync v2 — product photos as part of the product envelope.
 *
 * Same wire as pro/11-device-sync / pro/13-pos-ticket-sync: a REAL local
 * Invoices.SyncApi relay and a Node SyncPeer playing the owner's phone.
 * Product photos are budgeted JPEG data-URIs (services/images/resizeImage keeps
 * them ≤ 12 KB so the envelope stays under the relay's 16 KB decoded-gzip cap —
 * an oversized envelope would be dropped as payload_too_large, losing the whole
 * product edit). This spec is the end-to-end proof that photos sync:
 *   Desktop → phone: a product created with a photo through the real file
 *   picker arrives on the peer with the BYTE-IDENTICAL photoUrl.
 *   Removal: editing the product without the photo (whole-product update with
 *   no photoUrl key) reaches the peer as an upsert whose payload has no photo.
 *   phone → Desktop: a peer product carrying a data-URI photo renders with the
 *   exact same bytes on the Desktop list.
 */

import { test, expect } from '@playwright/test';
import zlib from 'zlib';
import { seedDeviceSyncUser } from '../../fixtures/pro-state';
import { mintSyncToken, relayUrl, startRelay, stopRelay, SyncPeer, SYNC_CO } from '../../fixtures/sync-relay';

// ── Minimal PNG encoder (Node zlib + CRC32) — no fixture files needed. ──────
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const byte of buf) c = (c >>> 8) ^ CRC_TABLE[(c ^ byte) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
};
/** RGB gradient PNG — big enough to exercise the canvas resizer (max side 320px). */
const pngBuffer = (width: number, height: number): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[o++] = (x * 255) % 256;
      raw[o++] = (y * 255) % 256;
      raw[o++] = ((x + y) * 127) % 256;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

/** Budget check mirrors PRODUCT_PHOTO_MAX_DATA_URL_CHARS in the app. */
const PRODUCT_PHOTO_MAX_DATA_URL_CHARS = 12_000;

/** Photo the phone pushes up — a small in-budget PNG data-URI. */
const PHONE_PHOTO = `data:image/png;base64,${pngBuffer(48, 32).toString('base64')}`;

const PRODUCT_NAME = 'Café Con Foto Sync';

test.describe.configure({ mode: 'serial' });

test.describe('Device Sync v2 — product photos', () => {
  let peer: SyncPeer;

  test.beforeAll(async () => {
    test.setTimeout(420_000); // first run (or relay-source change) rebuilds the snapshot
    await startRelay();
  });

  test.afterAll(async () => {
    await peer?.close();
    await stopRelay();
  });

  test('a Desktop photo reaches the phone byte-identically, removal propagates, and a phone photo renders on the Desktop', async ({ page }) => {
    test.setTimeout(180_000);
    peer = await new SyncPeer().connect();
    await peer.register();

    await seedDeviceSyncUser(page, 'pro_sync', {
      baseUrl: relayUrl(),
      token: mintSyncToken({ companies: [SYNC_CO] }),
    });

    // Open a sync session.
    await page.goto('/#/settings');
    await page.getByTestId('settings-device-sync').click();
    await expect(page.getByTestId('sync-v2-panel')).toBeVisible();
    await page.getByTestId('sync-now-button').click();
    await expect(page.getByTestId('sync-v2-status-text')).toHaveText('En línea', { timeout: 30_000 });

    // ── Desktop → phone: create a product WITH a photo through the real picker. ──
    await page.goto('/#/products');
    await page.getByTestId('add-product-btn').click();
    await expect(page.getByTestId('product-form')).toBeVisible();
    await page.getByLabel('Nombre del Producto', { exact: false }).first().fill(PRODUCT_NAME);
    await page.getByLabel('Precio Unitario', { exact: false }).first().fill('12.50');
    // 640×480 source: the renderer must run the canvas resizer (cap 320px) and the
    // JPEG budget ladder before storing the data-URI.
    await page.setInputFiles('input[data-testid="product-photo-input"]', {
      name: 'cafe.png',
      mimeType: 'image/png',
      buffer: pngBuffer(640, 480),
    });
    await expect(page.getByTestId('product-photo-preview')).toBeVisible();
    await page.getByTestId('submit-product-btn').click();
    await expect(page.getByTestId('product-list')).toBeVisible({ timeout: 10_000 });

    // The stored photo: shown in the row, within the sync budget.
    const desktopRow = page.locator('tr', { hasText: PRODUCT_NAME }).first();
    await expect(desktopRow.getByTestId('product-row-photo')).toBeVisible();
    const desktopPhoto = await desktopRow.getByTestId('product-row-photo').getAttribute('src');
    expect(desktopPhoto).toBeTruthy();
    expect(desktopPhoto!.startsWith('data:image/')).toBe(true);
    expect(desktopPhoto!.length).toBeLessThanOrEqual(PRODUCT_PHOTO_MAX_DATA_URL_CHARS);

    // The peer receives the SAME bytes — explicit photo equality.
    const received = await peer.waitForReceived(({ change, payload }) =>
      change.t === 'product' && payload?.productName === PRODUCT_NAME && typeof payload?.photoUrl === 'string');
    expect(received.change.op).toBe('upsert');
    expect(received.payload!.photoUrl).toBe(desktopPhoto);
    const productId = String(received.payload!.id);

    // ── Desktop removes the photo (update without photoUrl) → the peer reflects it. ──
    await desktopRow.click();
    await expect(page.getByTestId('product-detail')).toBeVisible();
    await expect(page.getByTestId('product-detail-photo')).toBeVisible();
    await expect(page.getByTestId('product-detail-photo')).toHaveAttribute('src', desktopPhoto!);
    await page.getByTestId('edit-product-btn').click();
    await expect(page.getByTestId('product-form')).toBeVisible();
    await expect(page.getByTestId('product-photo-preview')).toBeVisible();
    await page.getByTestId('product-photo-remove').click();
    await expect(page.getByTestId('product-photo-preview')).toHaveCount(0);
    await page.getByTestId('submit-product-btn').click();
    await expect(page.getByTestId('product-list')).toBeVisible({ timeout: 10_000 });

    // The whole-product update carries no photoUrl key — the peer's copy drops it too.
    const removal = await peer.waitForReceived(({ change, payload }) =>
      change.t === 'product' && payload?.id === productId && !('photoUrl' in (payload ?? {})));
    expect(removal.change.op).toBe('upsert');
    expect(removal.payload!.productName).toBe(PRODUCT_NAME);

    // ── phone → Desktop: a peer product with a photo renders with the same bytes. ──
    const nowIso = new Date().toISOString();
    await peer.upsert('product', {
      id: 'prod_android_foto',
      productName: 'Producto Foto Android',
      productCode: 'AND-FOTO',
      unitPrice: 7.25,
      unitOfMeasure: 'UND',
      taxCategory: 'GRAVADO',
      status: 'ACTIVE',
      companyId: '1',
      isActive: true,
      stock: 3,
      stockQuantity: 3,
      trackInventory: true,
      photoUrl: PHONE_PHOTO,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await page.goto('/#/products');
    const phoneRow = page.locator('tr', { hasText: 'Producto Foto Android' }).first();
    await expect(phoneRow.getByTestId('product-row-photo')).toBeVisible({ timeout: 30_000 });
    await expect(phoneRow.getByTestId('product-row-photo')).toHaveAttribute('src', PHONE_PHOTO);
  });
});
