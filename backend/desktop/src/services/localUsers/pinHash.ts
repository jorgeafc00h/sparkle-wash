// Local-user PIN hashing. PINs never get stored — only a salted, iterated
// SHA-256 (the pure-TS implementation shared with Device Sync, so this works
// the same in Electron's app:// renderer, the web build and Jest, without
// crypto.subtle). This is internal user control for a shared register, not a
// security boundary against someone with file access to the machine.

import { sha256Hex } from '@/services/sync/sha256';

const ITERATIONS = 1000;

/** 4–8 digits. */
export const PIN_PATTERN = /^\d{4,8}$/;

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export function createPinSalt(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hashPin(pin: string, salt: string): string {
  let digest = sha256Hex(`${salt}:${pin}`);
  for (let i = 1; i < ITERATIONS; i++) {
    digest = sha256Hex(`${salt}:${digest}`);
  }
  return digest;
}

export function verifyPin(pin: string, credentials: { pinHash: string; pinSalt: string }): boolean {
  if (!pin || !credentials.pinHash || !credentials.pinSalt) return false;
  const candidate = hashPin(pin, credentials.pinSalt);
  // Length-constant comparison.
  if (candidate.length !== credentials.pinHash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ credentials.pinHash.charCodeAt(i);
  }
  return diff === 0;
}
