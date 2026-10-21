import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Droplets, PlayCircle } from "lucide-react";
import { HttpApi } from "./lib/api";

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed"); }
          finally { setBusy(false); }
        },
      });
      if (button.current) window.google?.accounts.id.renderButton(button.current, { theme: "filled_black", size: "large", width: 356, shape: "pill" });
    };
    script.onerror = () => setError("Couldn't load Google sign-in. Check your connection.");
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [onLive]);

  return (
    <main className="signin">
      <div className="card signin-card">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark"><Droplets size={20} aria-hidden /></span>
          <span>
            <span className="brand-name" style={{ display: "block" }}>SparkleWash</span>
            <span className="brand-sub">Staff console</span>
          </span>
        </div>
        <div>
          <h1 style={{ fontSize: 22 }}>Sign in to run the floor</h1>
          <p className="muted" style={{ marginTop: 6 }}>Review camera arrivals, track plates and move jobs through the wash.</p>
        </div>
        {CLIENT_ID
          ? <div ref={button} aria-busy={busy} style={{ minHeight: 44 }} />
          : <p className="help">Google sign-in isn't set up for this build. Set <code className="mono">VITE_GOOGLE_CLIENT_ID</code> to connect to the API.</p>}
        {error && <p className="error-text" role="alert"><AlertTriangle size={15} aria-hidden />{error}</p>}
        <div className="divider">or</div>
        <button type="button" className="btn btn-block" onClick={onDemo}>
          <PlayCircle size={18} aria-hidden />Explore the demo
        </button>
        <p className="subtle" style={{ textAlign: "center" }}>The demo simulates ESP32 cameras in your browser. Nothing is saved.</p>
      </div>
    </main>
  );
}
