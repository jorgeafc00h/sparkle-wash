// Envelope payload codec: JSON → gzip → base64 (the `p` field). The relay caps the
// DECODED (gzipped) size at 16 KB, so compression is what lets a many-item invoice or a
// compra carrying its original DTE JSON fit. fflate is pure JS: identical output on
// Hermes, Electron and Jest. mtime is pinned to 0 so encoding is deterministic.

import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { SYNC_LIMITS } from './protocol';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE64_ALPHABET.length; i++) BASE64_LOOKUP[BASE64_ALPHABET[i]] = i;

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64_ALPHABET[(n >> 18) & 63] + BASE64_ALPHABET[(n >> 12) & 63]
      + BASE64_ALPHABET[(n >> 6) & 63] + BASE64_ALPHABET[n & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i] << 16;
    out += BASE64_ALPHABET[(n >> 18) & 63] + BASE64_ALPHABET[(n >> 12) & 63] + '==';
  } else if (remaining === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += BASE64_ALPHABET[(n >> 18) & 63] + BASE64_ALPHABET[(n >> 12) & 63]
      + BASE64_ALPHABET[(n >> 6) & 63] + '=';
  }
  return out;
};

export const base64ToBytes = (base64: string): Uint8Array => {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = BASE64_LOOKUP[clean[i]] ?? 0;
    const b = BASE64_LOOKUP[clean[i + 1]] ?? 0;
    const c = BASE64_LOOKUP[clean[i + 2]];
    const d = BASE64_LOOKUP[clean[i + 3]];
    const n = (a << 18) | (b << 12) | ((c ?? 0) << 6) | (d ?? 0);
    bytes[byteIndex++] = (n >> 16) & 255;
    if (c !== undefined) bytes[byteIndex++] = (n >> 8) & 255;
    if (d !== undefined) bytes[byteIndex++] = n & 255;
  }
  return bytes.subarray(0, byteIndex);
};

export class PayloadTooLargeError extends Error {
  constructor(public readonly bytes: number) {
    super(`Sync payload is ${bytes} bytes after compression (limit ${SYNC_LIMITS.maxPayloadBytes})`);
    this.name = 'PayloadTooLargeError';
  }
}

/** Encodes a payload; throws PayloadTooLargeError when the gzipped bytes exceed the relay cap. */
export const encodePayload = (payload: unknown): string => {
  const gz = gzipSync(strToU8(JSON.stringify(payload ?? null)), { level: 6, mtime: 0 });
  if (gz.length > SYNC_LIMITS.maxPayloadBytes) {
    throw new PayloadTooLargeError(gz.length);
  }
  return bytesToBase64(gz);
};

export const decodePayload = <T = unknown>(p: string): T => {
  const bytes = base64ToBytes(p);
  return JSON.parse(strFromU8(gunzipSync(bytes))) as T;
};
