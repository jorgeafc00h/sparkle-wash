// ElectronStorage — Platform-aware storage adapter
// In Electron production: routes through IPC bridge (file-backed JSON)
// In browser/dev: falls through to localStorage

declare global {
  interface Window {
    electronAPI?: {
      getPlatform?: () => string;
      storage?: {
        getItem: (key: string) => Promise<string | null>;
        setItem: (key: string, value: string) => Promise<void>;
        removeItem: (key: string) => Promise<void>;
        clear: () => Promise<void>;
        getAllKeys: () => Promise<string[]>;
        key: (index: number) => Promise<string | null>;
        length: () => Promise<number>;
      };
      [key: string]: any;
    };
  }
}

import { reportStorageWriteFailure } from './storageHealth';

function isElectron(): boolean {
  return typeof window !== 'undefined' &&
    window.electronAPI?.getPlatform?.() === 'electron' &&
    !!window.electronAPI?.storage;
}

// ── redux-persist compatible storage (async) ──────────────────────────
export const electronPersistStorage = {
  async getItem(key: string): Promise<string | null> {
    if (isElectron()) {
      return window.electronAPI!.storage!.getItem(key);
    }
    return localStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (isElectron()) {
        return await window.electronAPI!.storage!.setItem(key, value);
      }
      localStorage.setItem(key, value);
    } catch (error) {
      reportStorageWriteFailure(key, error);
      throw error;
    }
  },
  async removeItem(key: string): Promise<void> {
    if (isElectron()) {
      return window.electronAPI!.storage!.removeItem(key);
    }
    localStorage.removeItem(key);
  },
};

// ── localStorage-compatible API for services ────────────────────────────
// Provides sync-looking API that works in both environments.
// In Electron, operations are async but callers can await them.
export const appStorage = {
  async getItem(key: string): Promise<string | null> {
    if (isElectron()) {
      return window.electronAPI!.storage!.getItem(key);
    }
    return localStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (isElectron()) {
        await window.electronAPI!.storage!.setItem(key, value);
      } else {
        localStorage.setItem(key, value);
      }
    } catch (error) {
      reportStorageWriteFailure(key, error);
      throw error;
    }
  },
  async removeItem(key: string): Promise<void> {
    if (isElectron()) {
      await window.electronAPI!.storage!.removeItem(key);
    } else {
      localStorage.removeItem(key);
    }
  },
  async clear(): Promise<void> {
    if (isElectron()) {
      await window.electronAPI!.storage!.clear();
    } else {
      localStorage.clear();
    }
  },
  async getAllKeys(): Promise<string[]> {
    if (isElectron()) {
      return window.electronAPI!.storage!.getAllKeys();
    }
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }
    return keys;
  },
  async key(index: number): Promise<string | null> {
    if (isElectron()) {
      return window.electronAPI!.storage!.key(index);
    }
    return localStorage.key(index);
  },
  async length(): Promise<number> {
    if (isElectron()) {
      return window.electronAPI!.storage!.length();
    }
    return localStorage.length;
  },
};
