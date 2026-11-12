import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/** Minimal in-memory Web Storage, used only if neither the environment nor jsdom provides a working one. */
class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  getItem(key: string) { return this.items.has(String(key)) ? this.items.get(String(key))! : null; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string) { this.items.delete(String(key)); }
  setItem(key: string, value: string) { this.items.set(String(key), String(value)); }
}

/**
 * Node 25+ ships its own Web Storage: its global `localStorage` getter returns undefined unless Node runs with
 * --localstorage-file, and it shadows jsdom's. Put jsdom's storage back on the global (or an in-memory one), so the
 * suite behaves the same on Node 22 (CI) and newer Node, with no flags.
 */
function ensureStorage(name: "localStorage" | "sessionStorage") {
  let usable = false;
  try { usable = typeof globalThis[name]?.getItem === "function"; } catch { usable = false; }
  if (usable) return;
  let fromJsdom: Storage | undefined;
  try { fromJsdom = (globalThis as { jsdom?: { window: Window } }).jsdom?.window[name]; } catch { fromJsdom = undefined; }
  Object.defineProperty(globalThis, name, {
    configurable: true, enumerable: true, writable: true,
    value: typeof fromJsdom?.getItem === "function" ? fromJsdom : new MemoryStorage(),
  });
}
ensureStorage("localStorage");
ensureStorage("sessionStorage");

afterEach(() => {
  cleanup();
  localStorage.clear();
});
