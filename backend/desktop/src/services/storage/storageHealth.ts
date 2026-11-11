// Storage write failures used to be silent: redux-persist swallows setItem
// errors in production and the per-company databases only logged them, so once
// a key outgrew the main-process cap every new invoice/ticket vanished on the
// next restart. Every failed write is reported here and shown in a banner.

export interface StorageWriteFailure {
  key: string;
  message: string;
  at: string;
}

type Listener = (failure: StorageWriteFailure) => void;

const listeners = new Set<Listener>();
let lastFailure: StorageWriteFailure | null = null;

export function reportStorageWriteFailure(key: string, error: unknown): void {
  lastFailure = {
    key,
    message: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString(),
  };
  console.error(`[storage] write failed for "${key}": ${lastFailure.message}`);
  listeners.forEach((listener) => listener(lastFailure!));
}

export function onStorageWriteFailure(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLastStorageWriteFailure(): StorageWriteFailure | null {
  return lastFailure;
}

export function clearStorageWriteFailure(): void {
  lastFailure = null;
}
