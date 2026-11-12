/* Scene text, split per scene so each scene bundles only its own strings. Spanish is the source of truth;
   English mirrors it key for key (tests render both). `SCENE_COPY` in ./copy-all.ts combines them. */
export type SceneLang = "es" | "en";

export const CONTROL_COPY = {
  es: { pause: "Pausar animación", resume: "Reanudar animación", replay: "Repetir animación" },
  en: { pause: "Pause animation", resume: "Resume animation", replay: "Replay animation" },
};

export const HERO_COPY = {
  es: {
    caption: "Cada auto sale como del showroom.",
    description:
      "Animación: un auto deportivo azul con franjas naranjas encara al visitante, abre sus faros ocultos, un destello recorre el cofre y luego pasa de perfil.",
  },
  en: {
    caption: "Every car leaves showroom-ready.",
    description:
      "Animation: a blue sports car with orange stripes faces the visitor, opens its hidden headlights, a shine crosses the hood and then it rolls by in profile.",
  },
};

export const HOW_COPY = {
  es: {
    title: "De la cámara al ticket, en cuatro pasos:",
    steps: [
      "La ESP32-CAM de la entrada lee la placa.",
      "El equipo la confirma en Revisión con un toque.",
      "El trabajo avanza en el tablero hasta quedar listo.",
      "Se cobra en la caja y sale el ticket de trabajo.",
    ],
    camera: "ESP32-CAM · Entrada",
    confidence: "57% · Revisar",
    jobOpened: "Trabajo abierto",
    statuses: ["Llegó", "En cola", "Lavando", "Listo"],
    register: "Caja C1",
    vehicle: "Carro",
    ready: "Listo",
    charge: "Cobrar",
    paid: "Pagado",
  },
  en: {
    title: "From camera to ticket, in four steps:",
    steps: [
      "The entrance ESP32-CAM reads the plate.",
      "Staff confirm it in Review with one tap.",
      "The job moves across the board until it's done.",
      "It's charged at the register and the work ticket prints.",
    ],
    camera: "ESP32-CAM · Entrance",
    confidence: "57% · Review",
    jobOpened: "Job opened",
    statuses: ["Arrived", "Queued", "Washing", "Done"],
    register: "Register C1",
    vehicle: "Car",
    ready: "Done",
    charge: "Charge",
    paid: "Paid",
  },
};

export const DESK_COPY = {
  es: {
    title: "La app de escritorio, en tres pasos:",
    steps: [
      "Imprime el ticket de trabajo OT-C1-000045, aun sin conexión.",
      "Al volver la conexión, la caja pasa a «En vivo».",
      "El trabajo creado sin conexión se sincroniza solo.",
    ],
    window: "Car Spa · Caja C1",
    board: "Tablero de trabajos",
    offline: "Sin conexión",
    connecting: "Conectando…",
    live: "En vivo",
    pending: "1 pendiente",
    pendingSync: "Pendiente de sync",
    synced: "Sincronizado",
    rows: [
      { vehicle: "Carro", status: "Listo" },
      { vehicle: "Camioneta / SUV", status: "En cola" },
      { vehicle: "XL", status: "" },
    ],
  },
  en: {
    title: "The desktop app, in three steps:",
    steps: [
      "Prints work ticket OT-C1-000045, even offline.",
      "When the connection returns, the register shows “Live”.",
      "The job created offline syncs on its own.",
    ],
    window: "Car Spa · Register C1",
    board: "Job board",
    offline: "Offline",
    connecting: "Connecting…",
    live: "Live",
    pending: "1 pending",
    pendingSync: "Pending sync",
    synced: "Synced",
    rows: [
      { vehicle: "Car", status: "Done" },
      { vehicle: "SUV", status: "Queued" },
      { vehicle: "XL", status: "" },
    ],
  },
};

/** What the work ticket prints (the desktop app's fields; no prices on the marketing site). */
export const TICKET_COPY = {
  es: { title: "ORDEN DE TRABAJO", vehicle: "Vehículo: Carro", paid: "PAGADO", note: "Documento no fiscal" },
  en: { title: "WORK ORDER", vehicle: "Vehicle: Car", paid: "PAID", note: "Non-fiscal document" },
};

export const WORK_TICKET_NUMBER = "OT-C1-000045";
