// Event-stream transports for GET /api/events: the Electron main-process bridge
// (token in the Authorization header, no CORS) or fetch streaming in the browser.

import { getElectronCarwashBridge, isAbsoluteUrl } from './CarwashApiClient';

export interface EventStreamHandlers {
  /** Response headers arrived. A non-2xx status means the stream will end right after. */
  onOpen: (status: number) => void;
  onData: (text: string) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

export interface EventStreamHandle {
  close(): void;
}

export type EventStreamOpener = (cfg: { baseUrl: string; token: string }, handlers: EventStreamHandlers) => EventStreamHandle;

interface ElectronEventsBridge {
  carwashEventsStart?: (cfg: { baseUrl: string; token: string }) => Promise<unknown>;
  carwashEventsStop?: () => Promise<unknown>;
  onCarwashEvent?: (cb: (msg: { type: string; status?: number; data?: string; error?: string }) => void) => (() => void) | void;
}

function electronEvents(): ElectronEventsBridge | null {
  const api = typeof window !== 'undefined' ? (window as unknown as { electronAPI?: ElectronEventsBridge }).electronAPI : undefined;
  return api && typeof api.carwashEventsStart === 'function' && typeof api.onCarwashEvent === 'function' ? api : null;
}

export const openElectronEventStream: EventStreamOpener = (cfg, handlers) => {
  const api = electronEvents()!;
  let closed = false;
  const unsubscribe = api.onCarwashEvent!((msg) => {
    if (closed) return;
    if (msg.type === 'open') handlers.onOpen(msg.status ?? 0);
    else if (msg.type === 'chunk') handlers.onData(msg.data ?? '');
    else if (msg.type === 'end') handlers.onEnd();
    else if (msg.type === 'error') handlers.onError(msg.error ?? 'Error de red');
  });
  void api.carwashEventsStart!(cfg).catch((err: unknown) => {
    if (!closed) handlers.onError(err instanceof Error ? err.message : 'Error de red');
  });
  return {
    close() {
      if (closed) return;
      closed = true;
      if (typeof unsubscribe === 'function') unsubscribe();
      void api.carwashEventsStop?.();
    },
  };
};

export const openFetchEventStream: EventStreamOpener = (cfg, handlers) => {
  const controller = new AbortController();
  let closed = false;
  void (async () => {
    try {
      const response = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/api/events`, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${cfg.token}` },
        signal: controller.signal,
      });
      if (closed) return;
      handlers.onOpen(response.status);
      if (!response.ok || !response.body) {
        handlers.onEnd();
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done || closed) break;
        handlers.onData(decoder.decode(value, { stream: true }));
      }
      if (!closed) handlers.onEnd();
    } catch (err) {
      if (!closed) handlers.onError(err instanceof Error ? err.message : 'Error de red');
    }
  })();
  return {
    close() {
      closed = true;
      controller.abort();
    },
  };
};

export const defaultEventStreamOpener: EventStreamOpener = (cfg, handlers) =>
  electronEvents() && isAbsoluteUrl(cfg.baseUrl) ? openElectronEventStream(cfg, handlers) : openFetchEventStream(cfg, handlers);

export { getElectronCarwashBridge };
