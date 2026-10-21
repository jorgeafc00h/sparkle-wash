import { useCallback, useEffect, useMemo, useState } from "react";
import { Droplets, FlaskConical, Gauge, History, Kanban, LayoutDashboard, LogOut, Moon, ScanLine, Settings, Sun, type LucideIcon } from "lucide-react";
import { HttpApi, type SparkleApi } from "./lib/api";
import { ApiProvider, ToastProvider, useApi, useLive } from "./lib/context";
import { I18nProvider, useI18n } from "./i18n";
import type { MessageKey } from "./i18n/es";
import { LanguageSwitch } from "./components/ui";
import { DemoApi, type DemoOptions } from "./lib/demo";
import { SessionProvider } from "./lib/session";
import { AdminView, type AdminSection } from "./views/Admin";
import { useHashRoute, usePoll } from "./lib/hooks";
import { API_BASE, SignIn } from "./SignIn";
import { BoardView } from "./views/Board";
import { OverviewView } from "./views/Overview";
import { PlatesView } from "./views/Plates";
import { ReviewView } from "./views/Review";
import { StationsView } from "./views/Stations";

const ROUTES = ["floor", "review", "board", "plates", "bays", "admin"] as const;
type Route = (typeof ROUTES)[number];
const NAV: { route: Route; label: MessageKey; icon: LucideIcon; adminOnly?: true }[] = [
  { route: "floor", label: "nav.floor", icon: LayoutDashboard },
  { route: "review", label: "nav.review", icon: ScanLine },
  { route: "board", label: "nav.board", icon: Kanban },
  { route: "plates", label: "nav.plates", icon: History },
  { route: "bays", label: "nav.bays", icon: Gauge },
  { route: "admin", label: "nav.admin", icon: Settings, adminOnly: true },
];
const TOKEN_KEY = "sparklewash.session";

function storedApi(onUnauthorized: () => void): SparkleApi | null {
  // Links from the landing page open straight into the demo: /app/?demo=1
  if (new URLSearchParams(window.location.search).has("demo")) return new DemoApi();
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    return token ? new HttpApi(API_BASE, token, onUnauthorized) : null;
  } catch { return null; }
}

export function App() {
  return <I18nProvider><Console /></I18nProvider>;
}

function Console() {
  const [expired, setExpired] = useState(false);
  // A 401 means the session expired or was revoked (role change, removed from the team): back to sign-in.
  const onUnauthorized = useCallback(() => {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
    setExpired(true);
    setApi(null);
  }, []);
  const [api, setApi] = useState<SparkleApi | null>(() => storedApi(onUnauthorized));

  const onLive = useCallback((live: HttpApi) => {
    // Re-create the client so its 401 handler is this console's.
    const client = new HttpApi(API_BASE, live.sessionToken, onUnauthorized);
    try { sessionStorage.setItem(TOKEN_KEY, live.sessionToken); } catch { /* private mode */ }
    setExpired(false);
    setApi(client);
  }, [onUnauthorized]);
  const onDemo = useCallback((options?: DemoOptions) => {
    setExpired(false);
    setApi(new DemoApi(options));
    // A carwash created in the demo starts at its setup checklist.
    if (options?.seed === false) window.location.hash = "/admin";
  }, []);
  const signOut = useCallback(async () => {
    try { await api?.signOut(); } catch { /* already gone */ }
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
    setApi(null);
  }, [api]);

  useEffect(() => {
    if (!(api instanceof DemoApi)) return;
    const timer = window.setInterval(() => api.tick(), 9000);
    return () => window.clearInterval(timer);
  }, [api]);

  if (!api) return <ToastProvider><SignIn onLive={onLive} onDemo={onDemo} expired={expired} /></ToastProvider>;
  return (
    <ToastProvider>
      <ApiProvider api={api}>
        <Shell onSignOut={signOut} />
      </ApiProvider>
    </ToastProvider>
  );
}

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("sparklewash.theme") ?? ""; } catch { return ""; }
  });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("sparklewash.theme", theme); } catch { /* ignore */ }
  }, [theme]);
  const isDark = theme ? theme === "dark" : window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  return [isDark ? "dark" : "light", () => setTheme(isDark ? "light" : "dark")];
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const [route, arg, go] = useHashRoute(ROUTES, "floor");
  const [theme, toggleTheme] = useTheme();
  const api = useApi();
  const live = useLive();
  const { t } = useI18n();
  const { data: pending } = usePoll(() => api.pendingArrivals(), 15_000, ["arrivals"]);
  const { data: session } = usePoll(() => api.session(), 300_000);
  const isAdmin = session?.role === "admin";
  const nav = NAV.filter((n) => !n.adminOnly || isAdmin);
  const pendingCount = pending?.length ?? 0;
  const track = useCallback((plate: string) => go("plates", plate), [go]);
  const onSection = useCallback((section: AdminSection) => go("admin", section), [go]);

  // A freshly registered carwash lands on its setup checklist.
  useEffect(() => {
    if (session?.role === "admin" && new URLSearchParams(window.location.search).has("registro") && route === "floor") go("admin");
  }, [session, route, go]);

  const view = useMemo(() => {
    switch (route) {
      case "admin": return isAdmin ? <AdminView section={arg} onSection={onSection} /> : <OverviewView onReview={() => go("review")} onTrack={track} />;
      case "review": return <ReviewView />;
      case "board": return <BoardView onTrack={track} />;
      case "plates": return <PlatesView initialPlate={arg} onSearch={track} />;
      case "bays": return <StationsView />;
      default: return <OverviewView onReview={() => go("review")} onTrack={track} />;
    }
  }, [route, arg, go, track, isAdmin, onSection]);

  useEffect(() => {
    const label = NAV.find((n) => n.route === route)?.label;
    document.title = `${pendingCount ? `(${pendingCount}) ` : ""}${label ? t(label) : ""} · SparkleWash`;
  }, [route, pendingCount, t]);

  return (
    <SessionProvider session={session}>
    <div className="shell">
      <nav className="sidebar" aria-label={t("nav.main")}>
        <div className="brand">
          <span className="brand-mark"><Droplets size={20} aria-hidden /></span>
          <span>
            <span className="brand-name" style={{ display: "block" }}>{session?.tenant.name ?? t("app.name")}</span>
            <span className="brand-sub">{session ? t(`role.${session.role}`) : t("app.console")}</span>
          </span>
        </div>
        {nav.map(({ route: r, label, icon: Icon }) => (
          <a key={r} href={`#/${r}`} className="nav-link" aria-current={route === r ? "page" : undefined}>
            <Icon size={18} aria-hidden />{t(label)}
            {r === "review" && pendingCount > 0 && <span className="nav-badge" aria-label={t("nav.waiting", { count: pendingCount })}>{pendingCount}</span>}
          </a>
        ))}
        <div className="sidebar-foot">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {api.mode === "demo" && <span className="pill pill-violet"><FlaskConical size={13} aria-hidden />{t("shell.demoData")}</span>}
            {live.state === "live"
              ? <span className="pill pill-ok"><span className="dot live-dot" aria-hidden />{t("shell.live")}</span>
              : <span className="pill pill-warn"><span className="dot" aria-hidden />{t("shell.reconnecting")}</span>}
          </div>
          <LanguageSwitch />
          <button type="button" className="nav-link" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
            {theme === "dark" ? t("shell.lightMode") : t("shell.darkMode")}
          </button>
          <button type="button" className="nav-link" onClick={onSignOut}>
            <LogOut size={18} aria-hidden />{api.mode === "demo" ? t("shell.exitDemo") : t("shell.signOut")}
          </button>
        </div>
      </nav>
      <main className="main" id="main">
        <div className="mobile-only" style={{ justifyContent: "flex-end", marginBottom: 12 }}><LanguageSwitch compact /></div>
        {api.mode === "demo" && (
          <div className="banner">
            <FlaskConical size={18} aria-hidden />
            <span>{t("shell.demoBanner")}</span>
            <button type="button" className="btn btn-sm" onClick={onSignOut}>{t("shell.exitDemo")}</button>
          </div>
        )}
        {session?.role === "viewer" && <div className="banner" role="status">{t("shell.readOnly")}</div>}
        {view}
      </main>
      <nav className="tabbar" aria-label={t("nav.main")}>
        {nav.map(({ route: r, label, icon: Icon }) => (
          <a key={r} href={`#/${r}`} className="tab" aria-current={route === r ? "page" : undefined} style={{ textDecoration: "none" }}>
            <Icon size={22} aria-hidden />{t(r === "admin" ? "nav.adminShort" : label)}
            {r === "review" && pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
          </a>
        ))}
      </nav>
    </div>
    </SessionProvider>
  );
}
