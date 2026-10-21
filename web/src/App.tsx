import { useCallback, useEffect, useMemo, useState } from "react";
import { Droplets, FlaskConical, Gauge, History, Kanban, LayoutDashboard, LogOut, Moon, ScanLine, Sun, type LucideIcon } from "lucide-react";
import { HttpApi, type SparkleApi } from "./lib/api";
import { ApiProvider, ToastProvider, useApi } from "./lib/context";
import { DemoApi } from "./lib/demo";
import { useHashRoute, usePoll } from "./lib/hooks";
import { API_BASE, SignIn } from "./SignIn";
import { BoardView } from "./views/Board";
import { OverviewView } from "./views/Overview";
import { PlatesView } from "./views/Plates";
import { ReviewView } from "./views/Review";
import { StationsView } from "./views/Stations";

const ROUTES = ["floor", "review", "board", "plates", "bays"] as const;
type Route = (typeof ROUTES)[number];
const NAV: { route: Route; label: string; icon: LucideIcon }[] = [
  { route: "floor", label: "Live floor", icon: LayoutDashboard },
  { route: "review", label: "Review", icon: ScanLine },
  { route: "board", label: "Jobs", icon: Kanban },
  { route: "plates", label: "Plates", icon: History },
  { route: "bays", label: "Bays", icon: Gauge },
];
const TOKEN_KEY = "sparklewash.session";

function storedApi(): SparkleApi | null {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    return token ? new HttpApi(API_BASE, token) : null;
  } catch { return null; }
}

export function App() {
  const [api, setApi] = useState<SparkleApi | null>(storedApi);

  const onLive = useCallback((live: HttpApi) => {
    try { sessionStorage.setItem(TOKEN_KEY, live.sessionToken); } catch { /* private mode */ }
    setApi(live);
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

  if (!api) return <ToastProvider><SignIn onLive={onLive} onDemo={() => setApi(new DemoApi())} /></ToastProvider>;
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
  const { data: pending } = usePoll(() => api.pendingArrivals(), 5000);
  const pendingCount = pending?.length ?? 0;
  const track = useCallback((plate: string) => go("plates", plate), [go]);

  const view = useMemo(() => {
    switch (route) {
      case "review": return <ReviewView />;
      case "board": return <BoardView onTrack={track} />;
      case "plates": return <PlatesView initialPlate={arg} onSearch={track} />;
      case "bays": return <StationsView />;
      default: return <OverviewView onReview={() => go("review")} onTrack={track} />;
    }
  }, [route, arg, go, track]);

  useEffect(() => {
    document.title = `${pendingCount ? `(${pendingCount}) ` : ""}${NAV.find((n) => n.route === route)?.label ?? ""} · SparkleWash`;
  }, [route, pendingCount]);

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark"><Droplets size={20} aria-hidden /></span>
          <span>
            <span className="brand-name" style={{ display: "block" }}>SparkleWash</span>
            <span className="brand-sub">Staff console</span>
          </span>
        </div>
        {NAV.map(({ route: r, label, icon: Icon }) => (
          <a key={r} href={`#/${r}`} className="nav-link" aria-current={route === r ? "page" : undefined}>
            <Icon size={18} aria-hidden />{label}
            {r === "review" && pendingCount > 0 && <span className="nav-badge" aria-label={`${pendingCount} waiting`}>{pendingCount}</span>}
          </a>
        ))}
        <div className="sidebar-foot">
          {api.mode === "demo" && <span className="pill pill-violet" style={{ alignSelf: "flex-start" }}><FlaskConical size={13} aria-hidden />Demo data</span>}
          <button type="button" className="nav-link" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button type="button" className="nav-link" onClick={onSignOut}>
            <LogOut size={18} aria-hidden />{api.mode === "demo" ? "Exit demo" : "Sign out"}
          </button>
        </div>
      </nav>
      <main className="main" id="main">
        {api.mode === "demo" && (
          <div className="banner">
            <FlaskConical size={18} aria-hidden />
            <span>You're in the demo. New cars arrive every few seconds from simulated cameras.</span>
            <button type="button" className="btn btn-sm" onClick={onSignOut}>Exit demo</button>
          </div>
        )}
        {view}
      </main>
      <nav className="tabbar" aria-label="Main">
        {NAV.map(({ route: r, label, icon: Icon }) => (
          <a key={r} href={`#/${r}`} className="tab" aria-current={route === r ? "page" : undefined} style={{ textDecoration: "none" }}>
            <Icon size={22} aria-hidden />{label}
            {r === "review" && pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
          </a>
        ))}
      </nav>
    </div>
  );
}
