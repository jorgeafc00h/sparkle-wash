import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Droplets, PlayCircle } from "lucide-react";
import { ApiError, HttpApi } from "./lib/api";
import { LanguageSwitch } from "./components/ui";
import { useI18n } from "./i18n";

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
      renderButton(element: HTMLElement, options: Record<string, unknown>): void;
    } } };
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
export const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").replace(/\/$/, "");

export function SignIn({ onLive, onDemo }: { onLive: (api: HttpApi) => void; onDemo: () => void }) {
  const button = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<"signin.serverNotConfigured" | "signin.notStaff" | "signin.scriptFailed" | null>(null);
  const [busy, setBusy] = useState(false);
  const { t, locale } = useI18n();

  useEffect(() => {
    if (!CLIENT_ID || !button.current) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: async ({ credential }) => {
          setBusy(true);
          setError(null);
          try { onLive(await HttpApi.signIn(API_BASE, credential)); }
          catch (e) { setError(e instanceof ApiError && e.status === 503 ? "signin.serverNotConfigured" : "signin.notStaff"); }
          finally { setBusy(false); }
        },
      });
      if (button.current) window.google?.accounts.id.renderButton(button.current,
        { theme: "filled_black", size: "large", width: 356, shape: "pill", locale });
    };
    script.onerror = () => setError("signin.scriptFailed");
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [onLive, locale]);

  return (
    <main className="signin">
      <div className="card signin-card">
        <LanguageSwitch />
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark"><Droplets size={20} aria-hidden /></span>
          <span>
            <span className="brand-name" style={{ display: "block" }}>{t("app.name")}</span>
            <span className="brand-sub">{t("app.console")}</span>
          </span>
        </div>
        <div>
          <h1 style={{ fontSize: 22 }}>{t("signin.title")}</h1>
          <p className="muted" style={{ marginTop: 6 }}>{t("signin.body")}</p>
        </div>
        {CLIENT_ID
          ? <div ref={button} aria-busy={busy} style={{ minHeight: 44 }} />
          : <p className="help">{t("signin.notConfigured", { variable: "VITE_GOOGLE_CLIENT_ID" })}</p>}
        {error && <p className="error-text" role="alert"><AlertTriangle size={15} aria-hidden />{t(error)}</p>}
        <div className="divider">{t("signin.or")}</div>
        <button type="button" className="btn btn-block" onClick={onDemo}>
          <PlayCircle size={18} aria-hidden />{t("signin.demo")}
        </button>
        <p className="subtle" style={{ textAlign: "center" }}>{t("signin.demoNote")}</p>
      </div>
    </main>
  );
}
