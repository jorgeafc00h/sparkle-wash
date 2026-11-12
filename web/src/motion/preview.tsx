/* Dev-only preview for the motion scenes (not a build input). Serve web/ with `npx vite --port 5176 --strictPort`
   and open /src/motion/preview.html?view=hero|how|desk|car|all&lang=es|en. `window.__seek(ms)` freezes every
   animation at that time on the scene timelines, for deterministic screenshots. */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../design/tokens.css";
import { DesktopTicketScene, HeroScene, HowItWorksScene, MuscleCar, MuscleCarFront, type SceneLang } from "./index";

declare global {
  interface Window { __seek?: (ms: number) => void }
}
window.__seek = (ms: number) => {
  for (const animation of document.getAnimations()) {
    animation.pause();
    animation.currentTime = ms;
  }
};

const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "all";
const lang: SceneLang = params.get("lang") === "en" ? "en" : "es";

function Section({ id, dark, children, title }: { id: string; dark?: boolean; title: string; children: ReactNode }) {
  return (
    <section id={id} className={dark ? "cs-showroom" : undefined} style={{ padding: "48px 0", background: dark ? undefined : "#FFFFFF" }}>
      <div style={{ width: "min(1200px, calc(100% - 32px))", margin: "0 auto" }}>
        <p style={{ margin: "0 0 16px", font: "500 13px/1 Montserrat, sans-serif", letterSpacing: ".22em", textTransform: "uppercase", color: dark ? "#B7C3D9" : "#03515B" }}>{title}</p>
        {children}
      </div>
    </section>
  );
}

function CarSheet() {
  const panel = { background: "#0F1D40", borderRadius: 22, padding: 24, width: 1200, boxSizing: "border-box" as const };
  return (
    <div className="cs-showroom" style={{ padding: 32, display: "grid", gap: 32 }}>
      <div id="car-side" style={panel}><MuscleCar /></div>
      <div id="car-front" style={{ ...panel, display: "flex", gap: 24 }}>
        <MuscleCarFront size="50%" />
        <MuscleCarFront size="50%" headlights="on" />
      </div>
      <div id="car-front-large" style={{ ...panel, padding: "40px 160px" }}><MuscleCarFront headlights="on" /></div>
      <div id="car-small" style={{ display: "flex", gap: 24, alignItems: "end", flexWrap: "wrap" }}>
        <MuscleCar size={240} />
        <MuscleCar size={120} />
        <MuscleCarFront size={160} headlights="on" />
        <div style={{ background: "#fff", padding: 12, borderRadius: 12 }}><MuscleCar size={240} wheelsTurning /></div>
      </div>
    </div>
  );
}

function Scenes() {
  return (
    <>
      {(view === "hero" || view === "all") && (
        <Section id="hero" dark title="Hero">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 48, alignItems: "center" }}>
            <div style={{ flex: "1 1 360px", minWidth: 0 }}>
              <h1 style={{ margin: 0, font: "800 clamp(2.25rem, 5vw, 3.75rem)/1.05 'Saira Variable', sans-serif" }}>
                {lang === "es" ? "Cada auto sale como del showroom." : "Every car leaves showroom-ready."}
              </h1>
            </div>
            <div style={{ flex: "1 1 460px", minWidth: 0 }}>
              <HeroScene lang={lang} />
            </div>
          </div>
        </Section>
      )}
      {(view === "how" || view === "all") && (
        <Section id="how" title={lang === "es" ? "Cómo funciona" : "How it works"}>
          <HowItWorksScene lang={lang} />
        </Section>
      )}
      {(view === "desk" || view === "all") && (
        <Section id="desk" dark title={lang === "es" ? "App de escritorio" : "Desktop app"}>
          <div style={{ maxWidth: 760 }}>
            <DesktopTicketScene lang={lang} />
          </div>
        </Section>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{view === "car" ? <CarSheet /> : <Scenes />}</StrictMode>,
);
