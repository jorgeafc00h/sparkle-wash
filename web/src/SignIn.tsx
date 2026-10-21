import { useEffect, useRef, useState, type RefObject } from "react";
import { AlertTriangle, ArrowLeft, Building2, Droplets, Info, PlayCircle } from "lucide-react";
import { CarwashFields, type CarwashErrors } from "./components/CarwashForm";
import { LanguageSwitch } from "./components/ui";
import { useI18n } from "./i18n";
import type { MessageKey } from "./i18n/es";
import { ApiError, HttpApi } from "./lib/api";
import type { DemoOptions } from "./lib/demo";
import { validateCarwash } from "./lib/regions";
import type { TenantInput } from "./lib/types";

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

/**
 * Renders Google's sign-in button into `container`. The latest `onCredential` is always the one called:
 * Google keeps the callback from initialize(), so passing it directly would freeze stale form values.
 */
function useGoogleButton(container: RefObject<HTMLDivElement>, onCredential: (credential: string) => void, onLoadError: () => void, text: string) {
  const { locale } = useI18n();
  const latest = useRef(onCredential);
  latest.current = onCredential;
  useEffect(() => {
    if (!CLIENT_ID || !container.current) return;
    const render = () => {
      window.google?.accounts.id.initialize({ client_id: CLIENT_ID, callback: ({ credential }) => latest.current(credential) });
      if (container.current) window.google?.accounts.id.renderButton(container.current,
        { theme: "filled_black", size: "large", width: 356, shape: "pill", locale, text });
    };
    if (window.google) { render(); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = render;
    script.onerror = onLoadError;
    document.head.appendChild(script);
    return () => { script.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, text]);
}

type Mode = "signin" | "register";

export function SignIn({ onLive, onDemo, expired }: {
  onLive: (api: HttpApi) => void; onDemo: (options?: DemoOptions) => void; expired?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(() => new URLSearchParams(window.location.search).has("registro") ? "register" : "signin");
  const { t } = useI18n();
  return (
    <main className="signin">
      <div className={`card signin-card ${mode === "register" ? "wide" : ""}`}>
        <LanguageSwitch />
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark"><Droplets size={20} aria-hidden /></span>
          <span>
            <span className="brand-name" style={{ display: "block" }}>{t("app.name")}</span>
            <span className="brand-sub">{t("app.console")}</span>
          </span>
        </div>
        {mode === "signin"
          ? <SignInPanel onLive={onLive} onDemo={onDemo} expired={expired} onRegister={() => setMode("register")} />
          : <RegisterPanel onLive={onLive} onDemo={onDemo} onBack={() => setMode("signin")} />}
      </div>
    </main>
  );
}

function SignInPanel({ onLive, onDemo, expired, onRegister }: {
  onLive: (api: HttpApi) => void; onDemo: (options?: DemoOptions) => void; expired?: boolean; onRegister: () => void;
}) {
  const { t } = useI18n();
  const button = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  useGoogleButton(button, async (credential) => {
    setBusy(true);
    setError(null);
    try { onLive(await HttpApi.signIn(API_BASE, credential)); }
    catch (e) { setError(e instanceof ApiError && e.status === 503 ? "signin.serverNotConfigured" : "signin.notStaff"); }
    finally { setBusy(false); }
  }, () => setError("signin.scriptFailed"), "signin_with");

  return (
    <>
      {expired && <p className="banner" role="status"><Info size={18} aria-hidden />{t("shell.sessionExpired")}</p>}
      <div>
        <h1 style={{ fontSize: 22 }}>{t("signin.title")}</h1>
        <p className="muted" style={{ marginTop: 6 }}>{t("signin.body")}</p>
      </div>
      {CLIENT_ID
        ? <div ref={button} aria-busy={busy} style={{ minHeight: 44 }} />
        : <p className="help">{t("signin.notConfigured", { variable: "VITE_GOOGLE_CLIENT_ID" })}</p>}
      {error && <p className="error-text" role="alert"><AlertTriangle size={15} aria-hidden />{t(error)}</p>}
      <div className="divider">{t("signin.or")}</div>
      <button type="button" className="btn btn-block" onClick={() => onDemo()}>
        <PlayCircle size={18} aria-hidden />{t("signin.demo")}
      </button>
      <p className="subtle" style={{ textAlign: "center" }}>{t("signin.demoNote")}</p>
      <div className="register-teaser">
        <span>{t("signin.newCarwash")}</span>
        <button type="button" className="btn btn-sm" onClick={onRegister}><Building2 size={16} aria-hidden />{t("signin.registerCta")}</button>
      </div>
    </>
  );
}

function RegisterPanel({ onLive, onDemo, onBack }: {
  onLive: (api: HttpApi) => void; onDemo: (options?: DemoOptions) => void; onBack: () => void;
}) {
  const { t } = useI18n();
  const button = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<TenantInput>({ name: "", city: "", country: "SV", phone: "", timeZone: "America/El_Salvador" });
  const [errors, setErrors] = useState<CarwashErrors>({});
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<boolean | null>(CLIENT_ID ? null : false);

  useEffect(() => {
    if (CLIENT_ID) void HttpApi.registrationOpen(API_BASE).then(setOpen);
  }, []);

  function validate(): boolean {
    const found = validateCarwash(form);
    setErrors(found);
    return !found.name && !found.phone;
  }

  const clean = (): TenantInput => ({
    name: form.name.trim(), city: form.city?.trim() || undefined, country: form.country, phone: form.phone?.trim() || undefined, timeZone: form.timeZone,
  });

  useGoogleButton(button, async (credential) => {
    if (!validate()) return;
    setBusy(true);
    setError(null);
    try { onLive(await HttpApi.register(API_BASE, credential, clean())); }
    catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setError(status === 409 ? "register.already" : status === 403 ? "register.closed" : "register.failed");
    } finally { setBusy(false); }
  }, () => setError("signin.scriptFailed"), "continue_with");

  return (
    <>
      <div>
        <h1 style={{ fontSize: 22 }}>{t("register.title")}</h1>
        <p className="muted" style={{ marginTop: 6 }}>{t("register.body")}</p>
      </div>
      <form noValidate onSubmit={(e) => { e.preventDefault(); validate(); }}>
        <CarwashFields value={form} onChange={(next) => { setForm(next); if (errors.name || errors.phone) setErrors(validateCarwash(next)); }} errors={errors} />
      </form>
      {open === false && CLIENT_ID && <p className="banner" role="status"><Info size={18} aria-hidden />{t("register.closed")}</p>}
      {CLIENT_ID && open !== false && (
        <div className="field">
          <span className="label">{t("register.continueGoogle")}</span>
          <div ref={button} aria-busy={busy} style={{ minHeight: 44 }} />
          {busy && <p className="help" role="status">{t("register.creating")}</p>}
        </div>
      )}
      {error && <p className="error-text" role="alert"><AlertTriangle size={15} aria-hidden />{t(error)}</p>}
      {!CLIENT_ID && (
        <>
          <button type="button" className="btn btn-primary btn-block" onClick={() => { if (validate()) onDemo({ seed: false, tenant: clean() }); }}>
            <PlayCircle size={18} aria-hidden />{t("register.demo")}
          </button>
          <p className="subtle" style={{ textAlign: "center" }}>{t("register.demoNote")}</p>
        </>
      )}
      <button type="button" className="btn btn-ghost btn-block" onClick={onBack}><ArrowLeft size={16} aria-hidden />{t("register.back")}</button>
    </>
  );
}
