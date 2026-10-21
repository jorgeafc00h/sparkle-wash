import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { SparkleApi } from "./api";
import type { ChangeTopic, ConnectionState } from "./types";

const ApiContext = createContext<SparkleApi | null>(null);

type Listener = (topic: ChangeTopic) => void;
interface Live { listen(listener: Listener): () => void; state: ConnectionState }
const LiveContext = createContext<Live>({ listen: () => () => {}, state: "reconnecting" });

/** Holds one change-feed connection for the whole console and fans it out to the screens. */
export function ApiProvider({ api, children }: { api: SparkleApi; children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const [state, setState] = useState<ConnectionState>("reconnecting");
  useEffect(() => api.subscribe((topic) => listeners.current.forEach((l) => l(topic)), setState), [api]);
  const live = useMemo<Live>(() => ({
    state,
    listen: (listener) => {
      listeners.current.add(listener);
      return () => { listeners.current.delete(listener); };
    },
  }), [state]);
  return <ApiContext.Provider value={api}><LiveContext.Provider value={live}>{children}</LiveContext.Provider></ApiContext.Provider>;
}

export const useLive = () => useContext(LiveContext);

export function useApi(): SparkleApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi needs an ApiProvider");
  return api;
}

interface Toast { id: number; kind: "ok" | "error"; text: string }
const ToastContext = createContext<(kind: Toast["kind"], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "error" ? "toast-error" : ""}`}>
            {t.kind === "error"
              ? <AlertCircle size={18} color="var(--danger)" aria-hidden />
              : <CheckCircle2 size={18} color="var(--ok)" aria-hidden />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
