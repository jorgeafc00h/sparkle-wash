import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { HeroScene } from "../motion/HeroScene";
import {
  ArrowRight, Bluetooth, BookOpen, Building2, Camera, Check, ChevronDown, Cpu, Download, FileText, Gauge, History, Kanban,
  LayoutDashboard, Lightbulb, LogIn, Menu, MonitorSmartphone, PlayCircle, Printer, Receipt, RefreshCw, ScanLine, ShieldCheck,
  Tablet, Wifi, WifiOff, X,
} from "lucide-react";

// Below-the-fold scenes load on demand; each slot shows its static fallback until its chunk arrives.
const HowItWorksScene = lazy(() => import("../motion/HowItWorksScene").then((m) => ({ default: m.HowItWorksScene })));
const DesktopTicketScene = lazy(() => import("../motion/DesktopTicketScene").then((m) => ({ default: m.DesktopTicketScene })));
const PolishScene = lazy(() => import("../motion/extra/PolishScene").then((m) => ({ default: m.PolishScene })));
const MobileBoardScene = lazy(() => import("../motion/extra/MobileBoardScene").then((m) => ({ default: m.MobileBoardScene })));
const LogoIntroScene = lazy(() => import("../motion/extra/LogoIntroScene").then((m) => ({ default: m.LogoIntroScene })));

const DEMO_URL = "/app/?demo=1";
const APP_URL = "/app/";
const REGISTER_URL = "/app/?registro=1";
export const MANUAL_URL = "/manual/";
/** Stable URL: GitHub serves the installer attached to the newest release. The file name is a deployed identifier: keep it. */
export const DESKTOP_DOWNLOAD_URL = "https://github.com/jorgeafc00h/sparkle-wash/releases/latest/download/SparkleWash-Setup-latest.exe";
export const DESKTOP_RELEASES_URL = "https://github.com/jorgeafc00h/sparkle-wash/releases";

/**
 * Mount points for the CSS animation scenes (web/src/motion). Each is a plain `<div data-scene-slot="…">` whose children
 * are a static, accessible fallback; mounting a scene replaces those children and keeps the slot's box and styling.
 */
export const SCENE_SLOTS = ["hero", "how-it-works", "polish", "mobile", "desktop-ticket", "logo-intro"] as const;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * The page's motion layer, no library: scroll reveals (fade and rise, staggered children), floating frames that pause
 * offscreen, and a light parallax on the hero art. Only transform and opacity move; all of it is off under reduced motion.
 */
function useMotion() {
  useEffect(() => {
    const root = document.documentElement;
    const reveals = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const floats = document.querySelectorAll<HTMLElement>("[data-float]");
    if (reducedMotion() || !("IntersectionObserver" in window)) {
      reveals.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    root.classList.add("js-motion");
    const revealer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    reveals.forEach((el) => revealer.observe(el));
    const floater = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.classList.toggle("is-inview", entry.isIntersecting);
    });
    floats.forEach((el) => floater.observe(el));

    // Hero parallax: one passive scroll listener, one rAF per frame, only while the hero is on screen.
    const hero = document.querySelector<HTMLElement>("[data-parallax-root]");
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!hero) return;
      const y = Math.min(window.scrollY, hero.offsetHeight);
      hero.style.setProperty("--parallax", String(Math.round(y)));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      revealer.disconnect();
      floater.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      root.classList.remove("js-motion");
    };
  }, []);
}

export function Landing() {
  useMotion();
  return (
    <>
      <a className="skip" href="#contenido">Saltar al contenido</a>
      <Nav />
      <main id="contenido">
        <Hero />
        <HowItWorks />
        <Polish />
        <CameraSection />
        <Screens />
        <AppSection />
        <DesktopSection />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}

function Logo() {
  return (
    <a href="#" className="logo" aria-label="Car Spa, inicio">
      <span className="logo-mark" aria-hidden>
        <img src="/brand/car-spa-mark-ondark.svg" alt="" width="64" height="28" />
      </span>
      <span className="logo-word">Car Spa</span>
    </a>
  );
}

const NAV_LINKS: [string, string][] = [
  ["#como-funciona", "Cómo funciona"], ["#camara", "La cámara"], ["#pantallas", "Pantallas"], ["#app", "App"],
  ["#escritorio", "Escritorio"], [MANUAL_URL, "Manual"], ["#preguntas", "Preguntas"],
];

function Nav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <header className="nav cs-showroom">
      <div className="cs-wrap nav-inner">
        <Logo />
        <nav aria-label="Secciones" id="menu-secciones" className={`nav-links ${open ? "open" : ""}`}>
          {NAV_LINKS.map(([href, label]) => (
            <a key={href} className="cs-link-underline" href={href} onClick={close}>{label}</a>
          ))}
          <a className="cs-link-underline nav-register" href={REGISTER_URL} onClick={close}>Registrar mi autolavado</a>
          <a className="cs-link-underline nav-login" href={APP_URL}><LogIn size={16} aria-hidden />Entrar</a>
        </nav>
        <a className="cs-btn cs-btn--primary cs-btn--sm nav-cta" href={DEMO_URL}>Probar la demo</a>
        <button type="button" className="menu" aria-expanded={open} aria-controls="menu-secciones" aria-label="Menú"
          onClick={() => setOpen((v) => !v)}>
          {open ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
        </button>
      </div>
    </header>
  );
}

/** Section divider: the next section's ground rising in an S-curve, with an orange and a blue ribbon (the logo's swoosh). */
function Swoosh({ to }: { to: "white" | "alt" }) {
  return (
    <div className={`swoosh swoosh--${to}`} aria-hidden data-reveal="swoosh">
      <svg viewBox="0 0 1440 120" preserveAspectRatio="none" focusable="false">
        <path className="swoosh-fill" d="M0 120 V84 C 250 84 380 44 640 44 C 900 44 1080 98 1440 70 V120 Z" />
        <path className="swoosh-ribbon swoosh-ribbon--orange" d="M0 70 C 250 70 380 30 640 30" vectorEffect="non-scaling-stroke" />
        <path className="swoosh-ribbon swoosh-ribbon--blue" d="M640 30 C 900 30 1080 84 1440 56" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function Hero() {
  return (
    <section className="hero cs-showroom" data-parallax-root>
      <div className="cs-wrap hero-grid">
        <div className="hero-copy" data-reveal="stagger">
          <p className="cs-eyebrow cs-eyebrow--tagline">Automotive Care</p>
          <h1>Cada auto sale como del showroom.</h1>
          <p className="lead">
            Car Spa es el sistema para autolavados y centros de detallado premium: la cámara de la entrada lee la placa,
            tu equipo confirma el servicio en la tablet, cada trabajo avanza en un tablero en vivo y la caja imprime el ticket y cobra.
          </p>
          <div className="cta-row">
            <a className="cs-btn cs-btn--primary cs-btn--lg hero-cta" href={DEMO_URL}><PlayCircle size={20} aria-hidden />Probar la demo en vivo</a>
            <a className="cs-btn cs-btn--ghost cs-btn--lg" href={REGISTER_URL}><Building2 size={18} aria-hidden />Registrar mi autolavado</a>
          </div>
          <ul className="trust">
            <li><Check size={16} aria-hidden />Consola web, sin instalar nada</li>
            <li><Check size={16} aria-hidden />App para iPhone y iPad</li>
            <li><Check size={16} aria-hidden />Caja para Windows</li>
            <li><Check size={16} aria-hidden />En español</li>
          </ul>
        </div>
        <div className="hero-art" data-reveal>
          <div className="layer layer--back" aria-hidden>
            <span className="ribbon ribbon--orange" />
            <span className="ribbon ribbon--blue" />
          </div>
          <div className="layer layer--mid">
            {/* Scene slot: the lead mounts W2's hero scene (a wide car) here; the logo is the static fallback. */}
            <div data-scene-slot="hero" className="scene-slot scene-slot--hero">
              <HeroScene lang="es" hideCaption />
            </div>
          </div>
          <div className="layer layer--front" aria-hidden>
            <span className="plate-chip"><span className="plate-text">P903377</span><span className="cs-chip cs-chip--live">94 %</span></span>
            <span className="status-chip"><span className="dot" />Lavando · 12 min</span>
          </div>
        </div>
      </div>
      <Swoosh to="white" />
    </section>
  );
}

const STEPS = [
  { icon: Camera, title: "La cámara lee la placa",
    body: "Una ESP32-CAM en la entrada toma una foto cada medio segundo. Un gateway con YOLO encuentra el vehículo, el OCR lee la placa y varias fotos votan para evitar errores." },
  { icon: ShieldCheck, title: "Tu equipo confirma",
    body: "En la tablet, alguien compara la placa con la foto, elige el tipo de vehículo y el paquete. Un toque abre el trabajo." },
  { icon: Kanban, title: "El servicio avanza",
    body: "Llegó, en cola, lavando, listo: con tiempos en vivo y quién está asignado. La cámara de salida avisa cuando el auto se va." },
  { icon: Receipt, title: "Se cobra en la caja",
    body: "Car Spa para escritorio imprime el ticket de trabajo de cada vehículo, cobra y factura con los mismos datos." },
];

function HowItWorks() {
  return (
    <section id="como-funciona" className="section">
      <div className="cs-wrap">
        <div className="section-head" data-reveal="stagger">
          <p className="cs-eyebrow">Cómo funciona</p>
          <h2>De la entrada al ticket, sin libretas</h2>
          <p>La cámara hace el trabajo repetitivo. Tu equipo solo confirma lo que importa.</p>
        </div>
        <ol className="steps" data-reveal="stagger">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="cs-card step-card lift">
              <span className="step-num" aria-hidden>{i + 1}</span>
              <span className="step-icon"><Icon size={24} aria-hidden /></span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
        {/* Scene slot: "De la cámara al ticket". The static fallback is the same journey as a list. */}
        <div data-scene-slot="how-it-works" className="scene-slot scene-slot--how" data-reveal>
          <Suspense
            fallback={
              <>
              <ol className="flow" aria-label="De la cámara al ticket">
                <li className="flow-node">
                  <span className="flow-icon"><Camera size={20} aria-hidden /></span>
                  <strong>Entrada</strong>
                  <span className="flow-note">ESP32-CAM · una foto cada 0,5 s</span>
                </li>
                <li className="flow-node">
                  <span className="plate-chip plate-chip--sm"><span className="plate-text">P903377</span></span>
                  <strong>Placa leída</strong>
                  <span className="flow-note">94 % de confianza · confirmada</span>
                </li>
                <li className="flow-node">
                  <span className="cs-chip cs-chip--due"><Kanban size={14} aria-hidden />Lavando</span>
                  <strong>En la bahía</strong>
                  <span className="flow-note">12 min · equipo asignado</span>
                </li>
                <li className="flow-node">
                  <span className="flow-icon flow-icon--accent"><Printer size={20} aria-hidden /></span>
                  <strong>Ticket en la caja</strong>
                  <span className="flow-note">Impreso, cobrado y facturado</span>
                </li>
              </ol>
            
              </>
            }
          >
            <HowItWorksScene lang="es" />
          </Suspense>
        </div>
      </div>
    </section>
  );
}

function Polish() {
  return (
    <section id="detallado" className="section polish cs-showroom" aria-labelledby="detallado-titulo">
      <div className="cs-wrap polish-grid">
        <div className="polish-copy" data-reveal="stagger">
          <p className="cs-eyebrow">Detallado premium</p>
          <h2 id="detallado-titulo">Del polvo al brillo de showroom</h2>
          <p>
            Tus servicios de detallado ya vienen cargados: al confirmar el tipo de vehículo se aplica el precio de tu lista,
            y cada auto queda registrado con su placa, su equipo y su tiempo.
          </p>
          <ul className="polish-list">
            <li><Check size={18} aria-hidden />Quién lo atendió y cuánto tardó, en cada visita</li>
            <li><Check size={18} aria-hidden />El historial de cada placa, ideal para clientes frecuentes</li>
            <li><Check size={18} aria-hidden />Nada se abre sin que tu equipo lo confirme</li>
          </ul>
        </div>
        {/* Scene slot: before/after polish wipe. Static fallback: a still before/after panel. */}
        <div data-scene-slot="polish" className="scene-slot scene-slot--polish" data-reveal>
          <Suspense
            fallback={
              <>
              <div className="before-after" role="img" aria-label="Antes y después de un detallado: de una superficie opaca a un acabado con brillo">
                <span className="ba-half ba-before"><span className="ba-label">Antes</span></span>
                <span className="ba-half ba-after"><span className="ba-label">Después</span><span className="glint" /></span>
                <span className="ba-handle" />
              </div>
            
              </>
            }
          >
            <PolishScene locale="es" />
          </Suspense>
        </div>
      </div>
      <Swoosh to="alt" />
    </section>
  );
}

function CameraSection() {
  return (
    <section id="camara" className="section camera">
      <div className="cs-wrap">
        <div className="section-head" data-reveal="stagger">
          <p className="cs-eyebrow">El hardware</p>
          <h2>La ESP32-CAM: pequeña, barata y suficiente</h2>
          <p>Un módulo de unos 10 USD con cámara y Wi-Fi. No necesita computadora en cada bahía: solo corriente y señal.</p>
        </div>
        <div className="camera-grid">
          <div className="board-wrap" data-reveal>
            <img className="board" data-float src="/landing/art/esp32-cam.svg" alt="Ilustración del módulo ESP32-CAM con su cámara, chip ESP32-S, LED de flash y ranura microSD" width="300" height="430" loading="lazy" />
            <span className="callout" style={{ left: "-2%", top: "8%" }}><Camera size={16} aria-hidden />Cámara OV2640 · 2 MP</span>
            <span className="callout" style={{ right: "-4%", top: "24%" }}><Lightbulb size={16} aria-hidden />Flash LED para la noche</span>
            <span className="callout" style={{ left: "-6%", top: "50%" }}><Wifi size={16} aria-hidden />ESP32-S · Wi-Fi</span>
            <span className="callout" style={{ right: "-2%", top: "76%" }}>microSD opcional</span>
          </div>
          <div className="camera-copy" data-reveal="stagger">
            <h3>Qué hace cada parte</h3>
            <div className="split">
              <div className="cs-card split-card lift">
                <h4><Camera size={18} aria-hidden />La cámara</h4>
                <ul>
                  <li>Toma fotos de 800×600 en JPEG.</li>
                  <li>Las sirve por Wi-Fi en <code>/cam-hi.jpg</code>.</li>
                  <li>Reporta su estado en <code>/status</code> y enciende el flash con <code>/flash?on=1</code>.</li>
                </ul>
              </div>
              <div className="cs-card split-card lift">
                <h4><Cpu size={18} aria-hidden />El gateway</h4>
                <ul>
                  <li>Una mini PC o Raspberry Pi en tu red.</li>
                  <li>YOLOv3 con OpenCV detecta el vehículo.</li>
                  <li>El OCR lee la placa; 3 lecturas votan y se envía una sola llegada.</li>
                </ul>
              </div>
            </div>
            <h3>Dónde ponerla</h3>
            <LotDiagram />
            <ul className="tips">
              <li><Check size={16} aria-hidden />A la altura del parachoques, de 2 a 4 m de la línea de parada.</li>
              <li><Check size={16} aria-hidden />Máximo unos 30° de ángulo; la placa debe verse de al menos 120 px de ancho.</li>
              <li><Check size={16} aria-hidden />De noche: flash de la placa o un reflector infrarrojo.</li>
            </ul>
          </div>
        </div>
        <div className="install" data-reveal="stagger">
          <div className="cs-card install-parts">
            <h3>Lo que necesitas por cámara</h3>
            <ul>
              <li><strong>ESP32-CAM (AI-Thinker)</strong> con cámara OV2640</li>
              <li><strong>Programador USB</strong>: placa ESP32-CAM-MB o un adaptador USB-serial</li>
              <li><strong>Fuente de 5 V / 2 A</strong> estable (la cámara se reinicia con fuentes débiles)</li>
              <li><strong>Caja resistente al agua</strong> con ventana limpia frente al lente</li>
            </ul>
          </div>
          <ol className="install-steps">
            <li className="cs-card lift">
              <span className="install-num">1</span>
              <h4>Carga el firmware</h4>
              <p>Arduino IDE, placa <em>AI Thinker ESP32-CAM</em>, librerías <code>esp32cam</code> y <code>NimBLE-Arduino</code> 1.4.x, particiones «Huge APP». Sube <code>esp32_cam_server.ino</code> con GPIO0 a tierra; no hay que editar el código.</p>
            </li>
            <li className="cs-card lift">
              <span className="install-num">2</span>
              <h4>Conéctala por Bluetooth</h4>
              <p>Enciéndela con BOOT presionado. En la app Car Spa del iPhone o iPad elige la cámara y escribe tu Wi-Fi: queda guardado y aparece sola en la red (<code>sparklecam-entrance-cam.local</code>).</p>
            </li>
            <li className="cs-card lift">
              <span className="install-num">3</span>
              <h4>Monta y prueba</h4>
              <p>Desde la app ves la imagen en vivo y enciendes el flash para comprobar que la placa se lea bien. Luego apunta el gateway a la cámara y listo.</p>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}

function LotDiagram() {
  return (
    <svg className="lot" viewBox="0 0 560 220" role="img" aria-label="Diagrama del lugar: cámara de entrada, cámara en la bahía y cámara de salida">
      <rect x="0" y="0" width="560" height="220" rx="18" fill="#EEF2F8" />
      <rect x="20" y="70" width="520" height="80" rx="12" fill="#C9D2E0" />
      <path d="M40 110 H520" stroke="#FFFFFF" strokeWidth="4" strokeDasharray="18 14" />
      <rect x="200" y="20" width="160" height="180" rx="14" fill="#E8F0FF" stroke="#4D8DFF" strokeWidth="2" opacity=".9" />
      <text x="280" y="42" textAnchor="middle" fontWeight="800" fontSize="15" fill="#0142A8">BAHÍA DE LAVADO</text>
      {[
        { x: 70, label: "Entrada", color: "#FB5A00" },
        { x: 280, label: "Bahía", color: "#0142A8" },
        { x: 490, label: "Salida", color: "#03515B" },
      ].map(({ x, label, color }) => (
        <g key={label}>
          <path d={`M${x} 172 L${x - 34} 120 L${x + 34} 120 Z`} fill={color} opacity=".22" />
          <rect x={x - 16} y="168" width="32" height="26" rx="6" fill="#0B1530" />
          <circle cx={x} cy="181" r="7" fill={color} />
          <text x={x} y="212" textAnchor="middle" fontWeight="800" fontSize="14" fill="#0B1530">{label}</text>
        </g>
      ))}
      <g transform="translate(110 88)">
        <rect width="70" height="40" rx="10" fill="#0142A8" /><rect x="8" y="8" width="54" height="14" rx="4" fill="#E8F0FF" />
        <rect x="0" y="30" width="70" height="4" fill="#FB5A00" />
      </g>
      <path d="M190 108 l14 0 m-6 -6 l6 6 l-6 6" stroke="#0B1530" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const SIZES: Record<string, [number, number]> = {
  "en-vivo": [2560, 1600], revision: [2560, 1720], tablero: [2560, 1280], placas: [2560, 1520], bahias: [2560, 1040],
};

const SCREENS = [
  { id: "en-vivo", icon: LayoutDashboard, label: "En vivo", title: "Todo el lugar de un vistazo",
    body: "Lo que ven las cámaras en este momento, cuántos autos esperan revisión, cuántos están en las bahías y alertas de presión o jabón." },
  { id: "revision", icon: ScanLine, label: "Revisión", title: "Confirmar con la foto al lado",
    body: "La placa leída, su nivel de confianza y la foto. Si la cámara dudó, lo dice. Eliges vehículo y paquete y el precio sale solo." },
  { id: "tablero", icon: Kanban, label: "Trabajos", title: "Un tablero que se mueve solo",
    body: "Llegó, en cola, lavando, listo. Cada tarjeta muestra el tiempo, el paquete y quién está asignado. Se actualiza en vivo." },
  { id: "placas", icon: History, label: "Placas", title: "El historial de cada vehículo",
    body: "Cada vez que una cámara vio la placa, cada paso del trabajo, visitas y gasto. Ideal para clientes frecuentes." },
  { id: "bahias", icon: Gauge, label: "Bahías", title: "Equipos bajo control",
    body: "Presión de agua y nivel de jabón por bahía, con aviso cuando algo se sale de rango." },
] as const;

function Screens() {
  const [active, setActive] = useState<(typeof SCREENS)[number]["id"]>("revision");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = SCREENS.find((s) => s.id === active)!;
  const index = SCREENS.findIndex((s) => s.id === active);
  function onKey(event: React.KeyboardEvent) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const next = (index + (event.key === "ArrowRight" ? 1 : SCREENS.length - 1)) % SCREENS.length;
    setActive(SCREENS[next].id);
    tabs.current[next]?.focus();
  }
  return (
    <section id="pantallas" className="section screens cs-showroom">
      <div className="cs-wrap">
        <div className="section-head" data-reveal="stagger">
          <p className="cs-eyebrow">Pantallas reales</p>
          <h2>Hecho para la tablet junto a las bahías</h2>
          <p>Estas son capturas de la consola tal como la usa tu equipo, en modo demo.</p>
        </div>
        <div className="tabs" role="tablist" aria-label="Pantallas de la consola" onKeyDown={onKey} data-reveal>
          {SCREENS.map(({ id, icon: Icon, label }, i) => (
            <button key={id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`tab-${id}`}
              aria-selected={active === id} aria-controls="screen-panel" tabIndex={active === id ? 0 : -1}
              onClick={() => setActive(id)}>
              <Icon size={18} aria-hidden />{label}
            </button>
          ))}
        </div>
        <div className="screen-panel" id="screen-panel" role="tabpanel" aria-labelledby={`tab-${active}`} data-reveal>
          <div className="screen-float" data-float>
            <figure className="frame screen-shot" key={current.id}>
              <img src={`/landing/screens/${current.id}.jpg`} alt={`Pantalla "${current.label}" de la consola Car Spa`}
                width={SIZES[current.id][0]} height={SIZES[current.id][1]} loading="lazy" />
            </figure>
          </div>
          <div className="screen-copy">
            <h3>{current.title}</h3>
            <p>{current.body}</p>
            <a className="cs-btn cs-btn--primary" href={DEMO_URL}>Abrir esta pantalla en la demo<ArrowRight size={18} aria-hidden /></a>
            <div className="screen-phone-float" data-float aria-hidden>
              <figure className="frame phone screen-phone">
                <img src="/landing/screens/tablero-movil.jpg" alt="" width="780" height="1520" loading="lazy" />
              </figure>
            </div>
            <p className="note"><MonitorSmartphone size={16} aria-hidden />También en el celular, y como app para iPhone y iPad.</p>
          </div>
        </div>
      </div>
      <Swoosh to="white" />
    </section>
  );
}

const APP_FEATURES = [
  { icon: Tablet, title: "Pantalla dividida",
    body: "En el iPad ves las secciones, la lista y el detalle a la vez. En el iPhone, la misma consola en una mano." },
  { icon: WifiOff, title: "Sigue sin internet",
    body: "Confirma llegadas y mueve trabajos sin señal: los cambios se guardan en el dispositivo y se sincronizan al volver la conexión." },
  { icon: Bluetooth, title: "Cámaras por Bluetooth",
    body: "Configura el Wi-Fi de cada ESP32-CAM desde la app, sin cables ni editar código." },
  { icon: Camera, title: "En vivo en tu red",
    body: "La app encuentra las cámaras en el Wi-Fi del autolavado: mira la imagen y enciende el flash para ajustar el ángulo." },
];

function AppSection() {
  return (
    <section id="app" className="section">
      <div className="cs-wrap">
        <div className="section-head" data-reveal="stagger">
          <p className="cs-eyebrow">App para iPhone y iPad</p>
          <h2>La misma consola, en el bolsillo de tu equipo</h2>
          <p>Entra con la misma cuenta de Google y verás los mismos datos que en la consola web, en español.</p>
        </div>
        <div className="app-grid">
          <ul className="features" data-reveal="stagger">
            {APP_FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="cs-card feature-card lift">
                <span className="step-icon"><Icon size={24} aria-hidden /></span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ul>
          {/* Scene slot: the iPhone/iPad board. Static fallback: the real console on a phone. */}
          <div data-scene-slot="mobile" className="scene-slot scene-slot--mobile" data-reveal>
            <Suspense
              fallback={
                <>
                <div className="phone-float" data-float>
                  <figure className="frame phone mobile-phone">
                    <img src="/landing/screens/revision-movil.jpg" alt="La pantalla Revisión de Car Spa en un teléfono: placa leída, foto y paquete" width="780" height="1688" loading="lazy" />
                  </figure>
                </div>
              
                </>
              }
            >
              <MobileBoardScene locale="es" />
            </Suspense>
          </div>
        </div>
      </div>
    </section>
  );
}

const DESKTOP_FEATURES = [
  { icon: Printer, text: "Un ticket de trabajo impreso por cada vehículo, listo para el mostrador." },
  { icon: Check, text: "Cobra los servicios en caja, con tus paquetes y tus precios." },
  { icon: FileText, text: "Facturación electrónica (DTE) sin salir del punto de venta." },
  { icon: RefreshCw, text: "Se sincroniza con la app de iPhone y la consola web a través de la API de Car Spa." },
];

function DesktopSection() {
  return (
    <section id="escritorio" className="section desktop" aria-labelledby="escritorio-titulo">
      <div className="cs-wrap">
        <div className="desktop-card cs-showroom" data-reveal>
          <div className="desktop-body">
            <p className="cs-eyebrow">Para Windows</p>
            <h2 id="escritorio-titulo">Car Spa para escritorio</h2>
            <p className="desktop-lead">El punto de venta de tu caja: imprime el ticket de cada vehículo, cobra y factura, con los mismos datos que ve tu equipo en el celular.</p>
            <ul className="desktop-list">
              {DESKTOP_FEATURES.map(({ icon: Icon, text }) => (
                <li key={text}><Icon size={18} aria-hidden />{text}</li>
              ))}
            </ul>
            <div className="cta-row">
              <a className="cs-btn cs-btn--primary cs-btn--lg" data-testid="download-windows" href={DESKTOP_DOWNLOAD_URL} download rel="noopener">
                <Download size={20} aria-hidden />Descargar para Windows
              </a>
              <a className="cs-btn cs-btn--ghost cs-btn--lg" href={MANUAL_URL}><BookOpen size={18} aria-hidden />Manual de uso</a>
            </div>
            <p className="desktop-req">
              Requiere Windows 10 u 11 (64 bits). <a href={DESKTOP_RELEASES_URL} rel="noopener">Todas las versiones</a>
            </p>
            <p className="desktop-note">
              Windows SmartScreen puede mostrar una advertencia porque el instalador aún no está firmado. Si aparece, elige
              {" "}<strong>Más información → Ejecutar de todas formas</strong>.
            </p>
          </div>
          {/* Scene slot: the printed work ticket. Static fallback: a still ticket (no prices on the public page). */}
          <div data-scene-slot="desktop-ticket" className="scene-slot scene-slot--ticket">
            <Suspense
              fallback={
                <>
                <div className="ticket-float" data-float>
                  <div className="ticket" role="img" aria-label="Ejemplo de ticket de trabajo impreso: placa P903377, camioneta, Essential Spa, atendido por Rosa">
                    <img src="/brand/car-spa-logo.svg" alt="" width="132" height="75" />
                    <p className="ticket-title">Ticket de trabajo <span>#0142</span></p>
                    <dl>
                      <div><dt>Placa</dt><dd className="ticket-plate">P903377</dd></div>
                      <div><dt>Vehículo</dt><dd>Camioneta / SUV</dd></div>
                      <div><dt>Paquete</dt><dd>Essential Spa</dd></div>
                      <div><dt>Equipo</dt><dd>Rosa M.</dd></div>
                      <div><dt>Entrada</dt><dd>10:42</dd></div>
                    </dl>
                    <span className="ticket-code" />
                    <p className="ticket-thanks">¡Gracias por tu visita!</p>
                  </div>
                </div>
              
                </>
              }
            >
              <DesktopTicketScene lang="es" />
            </Suspense>
          </div>
        </div>
      </div>
    </section>
  );
}

const FAQ: { q: string; a: ReactNode }[] = [
  { q: "¿Cómo registro mi autolavado?",
    a: "Con «Registrar mi autolavado» escribes el nombre, ciudad y país, y entras con tu cuenta de Google, que queda como administradora. Desde Administración vinculas cada ESP32-CAM (cada una recibe su propia llave), invitas a tu equipo por correo y agregas a quienes lavan." },
  { q: "¿Qué pasa si la cámara lee mal una placa?",
    a: "Nunca se abre un trabajo sin que alguien lo confirme. La consola muestra la foto, la placa leída y su nivel de confianza; si la cámara dudó (0/O, 8/B), lo marca para revisar." },
  { q: "¿Funciona de noche?",
    a: "Sí, con buena luz sobre la placa: el LED de la ESP32-CAM, un reflector o un iluminador infrarrojo. La cámara también expone /flash?on=1 para encenderlo desde el gateway, o desde la app con el interruptor Flash de cada cámara." },
  { q: "¿Necesito una computadora potente?",
    a: "No. Las cámaras solo toman fotos. El reconocimiento corre en un gateway: una mini PC o una Raspberry Pi (con YOLOv3-tiny) en la misma red. Un gateway por cámara o varios procesos en el mismo equipo." },
  { q: "¿Se guardan las fotos?",
    a: "Solo la foto de evidencia de cada llegada, para que el personal pueda compararla. Las consultas requieren iniciar sesión con una cuenta de Google autorizada." },
  { q: "¿Y si se cae el internet?",
    a: "Las cámaras y el gateway trabajan en tu red local. Si la API no responde, el gateway reintenta con el mismo identificador de evento, así que no se duplican llegadas. En la app de iPhone y iPad el equipo puede seguir confirmando llegadas y moviendo trabajos; los cambios se sincronizan solos al volver la conexión." },
  { q: "¿Hay un manual para la caja?",
    a: <>Sí. El <a href={MANUAL_URL}>manual de Car Spa para escritorio</a> explica paso a paso cómo instalarlo, abrir la caja, imprimir tickets y cobrar.</> },
  { q: "¿Tengo varios autolavados?",
    a: "Cada autolavado se registra por separado, con sus propias cámaras, bahías, equipo y zona horaria. Nadie de un autolavado ve los datos de otro." },
  { q: "¿Está en otros idiomas?",
    a: "La consola está en español por defecto y se puede cambiar a inglés desde el menú. Cada persona elige su idioma en su dispositivo." },
];

function Faq() {
  return (
    <section id="preguntas" className="section faq">
      <div className="cs-wrap narrow">
        <div className="section-head" data-reveal="stagger">
          <p className="cs-eyebrow">Preguntas frecuentes</p>
          <h2>Lo que nos preguntan</h2>
        </div>
        <div className="faq-list" data-reveal="stagger">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="faq-item">
              <summary>{q}<ChevronDown size={20} aria-hidden /></summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="section final">
      <div className="cs-wrap">
        <div className="final-card cs-showroom" data-reveal="stagger">
          <div data-scene-slot="logo-intro" className="scene-slot scene-slot--logo">
            <Suspense fallback={<img src="/brand/car-spa-logo-ondark.svg" alt="Car Spa — Automotive Care" width="260" height="147" />}>
              <LogoIntroScene locale="es" />
            </Suspense>
          </div>
          <p className="cs-eyebrow cs-eyebrow--tagline">Automotive Care</p>
          <h2>Pruébalo con autos simulados, ahora mismo</h2>
          <p>La demo corre en tu navegador: llegan autos, lees placas, abres trabajos y ves la cámara de salida en acción. Cuando estés listo, registra tu autolavado y vincula tus cámaras.</p>
          <div className="cta-row center">
            <a className="cs-btn cs-btn--primary cs-btn--lg" href={DEMO_URL}><PlayCircle size={20} aria-hidden />Abrir la demo</a>
            <a className="cs-btn cs-btn--ghost cs-btn--lg" href={REGISTER_URL}><Building2 size={18} aria-hidden />Registrar mi autolavado</a>
          </div>
          <p className="final-login">¿Ya tienes cuenta? <a href={APP_URL}>Entrar al sistema</a></p>
          <p className="final-login">¿Usas Windows en la caja? <a href="#escritorio">Descargar Car Spa para escritorio</a></p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer cs-showroom">
      <div className="cs-wrap footer-inner">
        <div className="footer-brand">
          <img src="/brand/car-spa-logo-ondark.svg" alt="Car Spa — Automotive Care" width="200" height="113" loading="lazy" />
          <p>Detallado automotriz premium: cámaras ESP32-CAM, lectura de placas, un tablero para tu equipo y la caja.</p>
        </div>
        <nav aria-label="Pie de página" className="footer-links">
          <a className="cs-link-underline" href={MANUAL_URL}><BookOpen size={16} aria-hidden />Manual del escritorio</a>
          <a className="cs-link-underline" href={APP_URL}>Consola</a>
          <a className="cs-link-underline" href={DEMO_URL}>Probar la demo</a>
          <a className="cs-link-underline" href="#preguntas">Preguntas frecuentes</a>
        </nav>
        <p className="small">© {new Date().getFullYear()} Car Spa</p>
      </div>
    </footer>
  );
}
