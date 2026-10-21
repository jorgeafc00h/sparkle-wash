import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight, Camera, Check, ChevronDown, Cpu, Gauge, History, Kanban, LayoutDashboard, Lightbulb, LogIn, LogOut,
  MonitorSmartphone, PlayCircle, ScanLine, ShieldCheck, Wifi,
} from "lucide-react";
import catalogJson from "../../../contracts/v1/service-packages.json";
import type { Catalog } from "../lib/types";

const catalog = catalogJson as Catalog;
const DEMO_URL = "/app/?demo=1";
const APP_URL = "/app/";
const PACKAGE_COLORS: Record<string, { bg: string; fg: string; soft: string }> = {
  quick: { bg: "#dfe2e7", fg: "#13213a", soft: "#f1f2f4" },
  essential: { bg: "#5b7ea6", fg: "#ffffff", soft: "#e4ecf5" },
  renew: { bg: "#7fa98a", fg: "#ffffff", soft: "#e6f0e8" },
  supreme: { bg: "#1b1f27", fg: "#ffffff", soft: "#e3e3e5" },
};

/** Fades sections up as they scroll into view (skipped when the visitor prefers reduced motion). */
function useReveal() {
  useEffect(() => {
    const items = document.querySelectorAll<HTMLElement>("[data-reveal]");
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -10% 0px" });
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

export function Landing() {
  useReveal();
  return (
    <>
      <a className="skip" href="#contenido">Saltar al contenido</a>
      <Nav />
      <main id="contenido">
        <Hero />
        <Torn color="var(--ink)" />
        <VideoSection />
        <Torn color="var(--ink)" flip />
        <HowItWorks />
        <CameraSection />
        <Screens />
        <Packages />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}

function Logo() {
  return (
    <a href="#" className="logo" aria-label="SparkleWash, inicio">
      <span className="logo-mark paper" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 32 32"><path d="M16 4c4.5 6.5 8 10.5 8 14.5a8 8 0 0 1-16 0C8 14.5 11.5 10.5 16 4z" fill="#8fd3f4" /><path d="M12.5 19.5a3.5 3.5 0 0 0 3.5 3.5" stroke="#f6efe4" strokeWidth="2.4" fill="none" strokeLinecap="round" /></svg>
      </span>
      SparkleWash
    </a>
  );
}

function Nav() {
  const [open, setOpen] = useState(false);
  const links = [
    ["#como-funciona", "Cómo funciona"], ["#camara", "La cámara"], ["#pantallas", "Pantallas"],
    ["#paquetes", "Paquetes"], ["#preguntas", "Preguntas"],
  ];
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <Logo />
        <nav aria-label="Secciones" className={`nav-links ${open ? "open" : ""}`}>
          {links.map(([href, label]) => <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>)}
          <a className="nav-login" href={APP_URL}><LogIn size={16} aria-hidden />Entrar</a>
        </nav>
        <a className="btn btn-ink nav-cta" href={DEMO_URL}>Probar la demo</a>
        <button type="button" className="menu" aria-expanded={open} aria-label="Menú" onClick={() => setOpen((v) => !v)}>
          <span /><span /><span />
        </button>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="hero-sky" aria-hidden>
        <span className="sun paper" />
        <span className="cloud paper" style={{ left: "44%", top: "6%" }} />
        <span className="cloud paper" style={{ left: "2%", bottom: "26%", transform: "scale(.7)" }} />
      </div>
      <div className="wrap hero-grid">
        <div className="hero-copy" data-reveal>
          <p className="eyebrow"><ScanLine size={16} aria-hidden />ESP32-CAM + IA para autolavados</p>
          <h1>Cada carro, identificado <span className="hl">por su placa</span>.</h1>
          <p className="lead">
            SparkleWash conecta cámaras ESP32-CAM, lectura de placas con inteligencia artificial y un tablero para tu equipo.
            Sabes quién llegó, qué paquete lleva, quién lo está lavando y cuándo se fue.
          </p>
          <div className="cta-row">
            <a className="btn btn-coral btn-lg" href={DEMO_URL}><PlayCircle size={20} aria-hidden />Probar la demo en vivo</a>
            <a className="btn btn-paper btn-lg" href="#video">Ver el video</a>
          </div>
          <ul className="trust">
            <li><Check size={16} aria-hidden />En español</li>
            <li><Check size={16} aria-hidden />Tablet y celular</li>
            <li><Check size={16} aria-hidden />Sin instalar nada</li>
          </ul>
        </div>
        <div className="hero-art" aria-hidden>
          <img className="hero-cam paper" src="/landing/art/esp32-cam.svg" alt="" width="300" height="430" />
          <figure className="frame paper hero-screen">
            <span className="tape" style={{ left: 24, top: -14 }} />
            <span className="tape" style={{ right: 30, top: -12, transform: "rotate(7deg)" }} />
            <img src="/landing/screens/en-vivo.jpg" alt="" width="2560" height="1600" />
          </figure>
          <figure className="frame phone paper hero-phone">
            <img src="/landing/screens/revision-movil.jpg" alt="" width="780" height="1688" />
          </figure>
          <span className="plate-chip paper">P903377 <small>94%</small></span>
          <img className="hero-car paper" src="/landing/art/car.svg" alt="" width="380" height="190" />
        </div>
      </div>
      <div className="hills" aria-hidden>
        <svg viewBox="0 0 1440 200" preserveAspectRatio="none" className="paper"><path d="M0 110 Q240 30 520 100 T1040 80 T1440 70 V200 H0 Z" fill="#7fa98a" /></svg>
        <svg viewBox="0 0 1440 140" preserveAspectRatio="none" className="paper"><path d="M0 70 Q360 0 760 60 T1440 40 V140 H0 Z" fill="#0f766e" /></svg>
      </div>
    </section>
  );
}

function Torn({ color, flip }: { color: string; flip?: boolean }) {
  return (
    <div className={`torn ${flip ? "flip" : ""}`} aria-hidden>
      <svg viewBox="0 0 1440 40" preserveAspectRatio="none">
        <path d="M0 40 L0 18 L40 24 L90 12 L130 22 L190 10 L240 20 L300 8 L350 22 L410 14 L470 24 L530 9 L580 20 L640 12 L700 24 L760 10 L820 21 L880 13 L940 25 L1000 11 L1060 22 L1120 9 L1180 20 L1240 12 L1300 23 L1360 10 L1440 20 L1440 40 Z" fill={color} />
      </svg>
    </div>
  );
}

function VideoSection() {
  return (
    <section id="video" className="video-section">
      <div className="wrap">
        <div className="section-head light" data-reveal>
          <p className="eyebrow">Video · 1 minuto</p>
          <h2>Mira cómo funciona</h2>
          <p>De la cámara en la entrada al tablero de tu equipo, contado con las pantallas reales de SparkleWash.</p>
        </div>
        <div className="video-frame paper" data-reveal>
          <span className="tape" style={{ left: 40, top: -16 }} />
          <span className="tape" style={{ right: 50, top: -14, transform: "rotate(6deg)" }} />
          <video controls preload="metadata" playsInline poster="/landing/video/poster.jpg" width="1920" height="1080">
            <source src="/landing/video/como-funciona.mp4" type="video/mp4" />
            <track kind="captions" srcLang="es" label="Español" src="/landing/video/como-funciona.es.vtt" />
            Tu navegador no puede reproducir este video. <a href="/landing/video/como-funciona.mp4">Descárgalo aquí</a>.
          </video>
        </div>
        <details className="transcript">
          <summary>Leer la transcripción</summary>
          <ol>
            <li>Una ESP32-CAM en la entrada toma una foto cada medio segundo.</li>
            <li>YOLO encuentra el carro, el OCR lee la placa y tres fotos votan el resultado.</li>
            <li>Tu equipo confirma la placa, el vehículo y el paquete con un toque.</li>
            <li>Cada carro avanza en el tablero, con tiempos en vivo y su equipo asignado.</li>
            <li>La cámara de salida avisa cuando el carro se va, y cada placa guarda su historial.</li>
            <li>Quick, Essential, Renew y Supreme Spa: el precio sale solo según el vehículo.</li>
          </ol>
        </details>
      </div>
    </section>
  );
}

const STEPS = [
  { icon: Camera, color: "#8fd3f4", title: "La cámara mira", body: "Una ESP32-CAM en la entrada toma una foto cada medio segundo y la sirve por Wi-Fi." },
  { icon: Cpu, color: "#f8c14a", title: "La IA lee la placa", body: "Un gateway con YOLO encuentra el vehículo, el OCR lee la placa y varias fotos votan para evitar errores." },
  { icon: ShieldCheck, color: "#f97362", title: "Tu equipo confirma", body: "En la tablet, alguien compara la placa con la foto, elige el tipo de vehículo y el paquete. Un toque abre el trabajo." },
  { icon: Kanban, color: "#7fa98a", title: "El trabajo avanza", body: "Llegó, en cola, lavando, listo: con tiempos en vivo. La cámara de salida avisa cuando el carro se va." },
];

function HowItWorks() {
  return (
    <section id="como-funciona" className="section">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <p className="eyebrow">Cómo funciona</p>
          <h2>De la entrada a la salida, sin libretas</h2>
          <p>La cámara hace el trabajo repetitivo. Tu equipo solo confirma lo que importa.</p>
        </div>
        <ol className="steps">
          {STEPS.map(({ icon: Icon, color, title, body }, i) => (
            <li key={title} className="step-card paper" data-reveal style={{ ["--tilt" as string]: `${i % 2 ? 1.2 : -1.2}deg`, transitionDelay: `${i * 80}ms` }}>
              <span className="step-num">{i + 1}</span>
              <span className="step-icon paper" style={{ background: color }}><Icon size={26} aria-hidden /></span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function CameraSection() {
  return (
    <section id="camara" className="section camera">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <p className="eyebrow">El hardware</p>
          <h2>La ESP32-CAM: pequeña, barata y suficiente</h2>
          <p>Un módulo de unos 10 USD con cámara y Wi-Fi. No necesita computadora en cada bahía: solo corriente y señal.</p>
        </div>
        <div className="camera-grid">
          <div className="board-wrap" data-reveal>
            <img className="board paper" src="/landing/art/esp32-cam.svg" alt="Ilustración del módulo ESP32-CAM con su cámara, chip ESP32-S, LED de flash y ranura microSD" width="300" height="430" />
            <span className="callout paper" style={{ left: "-4%", top: "8%" }}><Camera size={16} aria-hidden />Cámara OV2640 · 2 MP</span>
            <span className="callout paper" style={{ right: "-6%", top: "22%" }}><Lightbulb size={16} aria-hidden />Flash LED para la noche</span>
            <span className="callout paper" style={{ left: "-8%", top: "48%" }}><Wifi size={16} aria-hidden />ESP32-S · Wi-Fi</span>
            <span className="callout paper" style={{ right: "-4%", top: "76%" }}>microSD opcional</span>
          </div>
          <div className="camera-copy" data-reveal>
            <h3>Qué hace cada parte</h3>
            <div className="split">
              <div className="split-card paper">
                <h4><Camera size={18} aria-hidden />La cámara</h4>
                <ul>
                  <li>Toma fotos de 800×600 en JPEG.</li>
                  <li>Las sirve por Wi-Fi en <code>/cam-hi.jpg</code>.</li>
                  <li>Reporta su estado en <code>/status</code> y enciende el flash con <code>/flash?on=1</code>.</li>
                </ul>
              </div>
              <div className="split-card paper">
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
        <div className="install" data-reveal>
          <div className="install-parts paper">
            <h3>Lo que necesitas por cámara</h3>
            <ul>
              <li><strong>ESP32-CAM (AI-Thinker)</strong> con cámara OV2640</li>
              <li><strong>Programador USB</strong>: placa ESP32-CAM-MB o un adaptador USB-serial</li>
              <li><strong>Fuente de 5 V / 2 A</strong> estable (la cámara se reinicia con fuentes débiles)</li>
              <li><strong>Caja resistente al agua</strong> con ventana limpia frente al lente</li>
            </ul>
          </div>
          <ol className="install-steps">
            <li className="paper">
              <span>1</span>
              <h4>Carga el firmware</h4>
              <p>Arduino IDE, placa <em>AI Thinker ESP32-CAM</em>, librería <code>esp32cam</code>. Abre <code>esp32_cam_server.ino</code> y súbelo con GPIO0 a tierra.</p>
            </li>
            <li className="paper">
              <span>2</span>
              <h4>Configura Wi-Fi y nombre</h4>
              <p>Escribe tu red y un nombre por cámara: <code>entrance-cam</code>, <code>bay1-cam</code> o <code>exit-cam</code>. El monitor serie muestra su IP.</p>
            </li>
            <li className="paper">
              <span>3</span>
              <h4>Monta y prueba</h4>
              <p>Abre <code>http://IP/cam-hi.jpg</code> desde el celular: si ves la placa clara, apunta el gateway a esa dirección y listo.</p>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}

function LotDiagram() {
  return (
    <svg className="lot paper" viewBox="0 0 560 220" role="img" aria-label="Diagrama del lugar: cámara de entrada, cámara en la bahía y cámara de salida">
      <rect x="0" y="0" width="560" height="220" rx="18" fill="#e9dcc5" />
      <rect x="20" y="70" width="520" height="80" rx="12" fill="#cdbb9b" />
      <path d="M40 110 H520" stroke="#f6efe4" strokeWidth="4" strokeDasharray="18 14" />
      <rect x="200" y="20" width="160" height="180" rx="14" fill="#8fd3f4" opacity=".55" />
      <text x="280" y="42" textAnchor="middle" fontWeight="800" fontSize="15" fill="#13213a">BAHÍA DE LAVADO</text>
      {[
        { x: 70, label: "Entrada", color: "#f97362" },
        { x: 280, label: "Bahía", color: "#f8c14a" },
        { x: 490, label: "Salida", color: "#7fa98a" },
      ].map(({ x, label, color }) => (
        <g key={label}>
          <path d={`M${x} 172 L${x - 34} 120 L${x + 34} 120 Z`} fill={color} opacity=".35" />
          <rect x={x - 16} y="168" width="32" height="26" rx="6" fill="#13213a" />
          <circle cx={x} cy="181" r="7" fill={color} />
          <text x={x} y="212" textAnchor="middle" fontWeight="800" fontSize="14" fill="#13213a">{label}</text>
        </g>
      ))}
      <g transform="translate(110 88)">
        <rect width="70" height="40" rx="10" fill="#f97362" /><rect x="8" y="8" width="54" height="14" rx="4" fill="#bfe8fb" />
      </g>
      <path d="M190 108 l14 0 m-6 -6 l6 6 l-6 6" stroke="#13213a" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const SIZES: Record<string, [number, number]> = {
  "en-vivo": [2560, 1600], revision: [2560, 1720], tablero: [2560, 1280], placas: [2560, 1520], bahias: [2560, 1040],
};

const SCREENS = [
  { id: "en-vivo", icon: LayoutDashboard, label: "En vivo", title: "Todo el lugar de un vistazo",
    body: "Lo que ven las cámaras en este momento, cuántos carros esperan revisión, cuántos están en las bahías y alertas de presión o jabón." },
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
    <section id="pantallas" className="section screens">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <p className="eyebrow">Pantallas reales</p>
          <h2>Hecho para la tablet junto a las bahías</h2>
          <p>Estas son capturas de la consola tal como la usa tu equipo, en modo demo.</p>
        </div>
        <div className="tabs" role="tablist" aria-label="Pantallas de la consola" onKeyDown={onKey}>
          {SCREENS.map(({ id, icon: Icon, label }, i) => (
            <button key={id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`tab-${id}`}
              aria-selected={active === id} aria-controls="screen-panel" tabIndex={active === id ? 0 : -1}
              onClick={() => setActive(id)}>
              <Icon size={18} aria-hidden />{label}
            </button>
          ))}
        </div>
        <div className="screen-panel" id="screen-panel" role="tabpanel" aria-labelledby={`tab-${active}`}>
          <figure className="frame paper screen-shot" key={current.id}>
            <span className="tape" style={{ left: 30, top: -14 }} />
            <span className="tape" style={{ right: 40, top: -12, transform: "rotate(6deg)" }} />
            <img src={`/landing/screens/${current.id}.jpg`} alt={`Pantalla "${current.label}" de la consola SparkleWash`}
              width={SIZES[current.id][0]} height={SIZES[current.id][1]} />
          </figure>
          <div className="screen-copy">
            <h3>{current.title}</h3>
            <p>{current.body}</p>
            <a className="btn btn-ink" href={DEMO_URL}>Abrir esta pantalla en la demo<ArrowRight size={18} aria-hidden /></a>
            <figure className="frame phone paper screen-phone" aria-hidden>
              <img src="/landing/screens/tablero-movil.jpg" alt="" width="780" height="1520" loading="lazy" />
            </figure>
            <p className="note"><MonitorSmartphone size={16} aria-hidden />También en el celular, con la barra de navegación abajo.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Packages() {
  const money = (n: number) => `$${n}`;
  return (
    <section id="paquetes" className="section packages">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <p className="eyebrow">Paquetes de servicio</p>
          <h2>Más que un lavado</h2>
          <p>Tus paquetes y precios ya vienen cargados. Al confirmar el vehículo, el precio correcto se aplica solo.</p>
        </div>
        <div className="price-table" data-reveal>
          <div className="price-head" />
          {catalog.packages.map((p, i) => {
            const c = PACKAGE_COLORS[p.id];
            return (
              <article key={p.id} className="pack-card paper" style={{ ["--tilt" as string]: `${[-1.4, .8, -.6, 1.2][i]}deg` }}>
                <header style={{ background: c.bg, color: c.fg }}>
                  <h3>{p.name.replace(" Spa", "")} <span>Spa</span></h3>
                  <p>{p.subtitle}</p>
                </header>
                <ul>{p.items.map((item) => <li key={item}>{item}</li>)}</ul>
                <dl className="pack-prices">
                  {catalog.vehicleClasses.map((v) => (
                    <div key={v.id}><dt>{v.name}</dt><dd>{money(p.prices[v.id])}</dd></div>
                  ))}
                </dl>
                <p className="tagline">{p.tagline}</p>
              </article>
            );
          })}
          {catalog.vehicleClasses.map((v) => (
            <div key={v.id} className="price-row">
              <span className="vehicle paper">{v.name}</span>
              {catalog.packages.map((p) => (
                <span key={p.id} className="price paper" style={{ background: PACKAGE_COLORS[p.id].soft }}
                  aria-label={`${p.name}, ${v.name}: ${money(p.prices[v.id])}`}>
                  {money(p.prices[v.id])}
                </span>
              ))}
            </div>
          ))}
        </div>
        <p className="tag-line">Cuida lo que te lleva más lejos</p>
      </div>
    </section>
  );
}

const FAQ: { q: string; a: ReactNode }[] = [
  { q: "¿Qué pasa si la cámara lee mal una placa?",
    a: "Nunca se abre un trabajo sin que alguien lo confirme. La consola muestra la foto, la placa leída y su nivel de confianza; si la cámara dudó (0/O, 8/B), lo marca para revisar." },
  { q: "¿Funciona de noche?",
    a: "Sí, con buena luz sobre la placa: el LED de la ESP32-CAM, un reflector o un iluminador infrarrojo. La cámara también expone /flash?on=1 para encenderlo desde el gateway." },
  { q: "¿Necesito una computadora potente?",
    a: "No. Las cámaras solo toman fotos. El reconocimiento corre en un gateway: una mini PC o una Raspberry Pi (con YOLOv3-tiny) en la misma red. Un gateway por cámara o varios procesos en el mismo equipo." },
  { q: "¿Se guardan las fotos?",
    a: "Solo la foto de evidencia de cada llegada, para que el personal pueda compararla. Las consultas requieren iniciar sesión con una cuenta de Google autorizada." },
  { q: "¿Y si se cae el internet?",
    a: "Las cámaras y el gateway trabajan en tu red local. Si la API no responde, el gateway reintenta con el mismo identificador de evento, así que no se duplican llegadas." },
  { q: "¿Está en otros idiomas?",
    a: "La consola está en español por defecto y se puede cambiar a inglés desde el menú. Cada persona elige su idioma en su dispositivo." },
];

function Faq() {
  return (
    <section id="preguntas" className="section faq">
      <div className="wrap narrow">
        <div className="section-head" data-reveal>
          <p className="eyebrow">Preguntas frecuentes</p>
          <h2>Lo que nos preguntan</h2>
        </div>
        <div className="faq-list">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="faq-item paper">
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
    <section className="final">
      <div className="hills" aria-hidden>
        <svg viewBox="0 0 1440 160" preserveAspectRatio="none" className="paper"><path d="M0 80 Q280 10 600 70 T1440 50 V160 H0 Z" fill="#7fa98a" /></svg>
        <svg viewBox="0 0 1440 110" preserveAspectRatio="none" className="paper"><path d="M0 50 Q360 0 760 44 T1440 30 V110 H0 Z" fill="#0f766e" /></svg>
      </div>
      <div className="wrap final-inner" data-reveal>
        <h2>Pruébalo con carros simulados, ahora mismo</h2>
        <p>La demo corre en tu navegador: llegan carros, lees placas, abres trabajos y ves la cámara de salida en acción.</p>
        <div className="cta-row center">
          <a className="btn btn-coral btn-lg" href={DEMO_URL}><PlayCircle size={20} aria-hidden />Abrir la demo</a>
          <a className="btn btn-paper btn-lg" href={APP_URL}><LogOut size={18} aria-hidden style={{ transform: "scaleX(-1)" }} />Entrar al sistema</a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <Logo />
        <p>Cámaras ESP32-CAM, lectura de placas y un tablero para tu equipo.</p>
        <p className="small">© {new Date().getFullYear()} SparkleWash</p>
      </div>
    </footer>
  );
}
