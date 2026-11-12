/* Dev-only preview of the extra scenes: `npx vite --port 5177 --strictPort` from web/, then open
   /src/motion/extra/preview.html?scene=polish|board|logo|all&locale=es|en&tone=dark|light */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../../design/tokens.css";
import { LogoIntroScene, MobileBoardScene, PolishScene, type ExtraLocale } from "./index";

const params = new URLSearchParams(location.search);
const scene = params.get("scene") ?? "all";
const locale: ExtraLocale = params.get("locale") === "en" ? "en" : "es";
const tone = params.get("tone") === "light" ? "light" : "dark";
document.documentElement.lang = locale;

function Section({ title, light, children }: { title: string; light?: boolean; children: ReactNode }) {
  return (
    <section className={light ? undefined : "cs-showroom"} style={{ padding: "48px 0", background: light ? "#FFFFFF" : undefined }}>
      <div className="cs-wrap" style={{ display: "grid", gap: 24 }}>
        <p className="cs-eyebrow">{title}</p>
        {children}
      </div>
    </section>
  );
}

function App() {
  const show = (name: string) => scene === "all" || scene === name;
  return (
    <main style={{ margin: 0, minHeight: "100vh", background: "#0B1530" }}>
      {show("logo") && (
        <Section title="LogoIntroScene" light={tone === "light"}>
          <div style={{ padding: "32px 0" }}><LogoIntroScene locale={locale} tone={tone} /></div>
        </Section>
      )}
      {show("polish") && <Section title="PolishScene"><PolishScene locale={locale} /></Section>}
      {show("board") && <Section title="MobileBoardScene"><MobileBoardScene locale={locale} /></Section>}
    </main>
  );
}

document.body.style.margin = "0";
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
