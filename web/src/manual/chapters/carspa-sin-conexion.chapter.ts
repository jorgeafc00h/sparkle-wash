import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "sin-conexion",
  "order": 160,
  "group": "Car Spa",
  "title": "Trabajar sin conexión",
  "summary": "Qué queda en cola cuando no hay internet y qué significa «Error de sync».",
  "sections": [
    {
      "id": "cola",
      "title": "Qué pasa sin internet",
      "body": [
        "Car Spa guarda en una cola, en esta computadora, todo lo que haces sin conexión. La cola conserva el orden y se envía sola cuando vuelve la comunicación; también puedes forzarla con «Sincronizar».",
        "En la cola entran: nuevos servicios, cambios de estado, asignaciones de empleado, números de orden y pagos de lavado.",
        "Un servicio creado sin conexión recibe su número de orden y se imprime en el momento. La tarjeta muestra «Pendiente de sync» y la cabecera muestra «Sin conexión» y «N pendientes»."
      ],
      "figure": {
        "src": "/manual/img/carspa-sin-conexion.webp",
        "alt": "Tablero sin conexión: etiqueta Sin conexión, contador de pendientes y una tarjeta con Pendiente de sync."
      }
    },
    {
      "id": "error",
      "title": "Qué significa «Error de sync»",
      "body": [
        "Cuando el servidor rechaza una operación en cola (por ejemplo, abrir un servicio para una placa que ya tiene uno abierto), esa operación se marca con error y no se reintenta sola. La tarjeta muestra «Error de sync»; pasa el cursor sobre la etiqueta para leer el motivo.",
        "Las demás operaciones siguen su curso. Revisa el motivo, corrige el dato en el tablero si hace falta y vuelve a registrar el servicio.",
        "Si lo que falla es la comunicación (sin internet, o el servidor no responde), la operación no se marca con error: se queda pendiente y se reintenta en la siguiente sincronización."
      ],
      "figure": {
        "src": "/manual/img/carspa-sin-conexion-error.webp",
        "alt": "Tablero con una tarjeta marcada Error de sync."
      }
    },
    {
      "id": "cuentas",
      "title": "Cada cuenta envía solo lo suyo",
      "body": [
        "Lo que queda en cola pertenece a la cuenta de Car Spa (y al servidor) con la que lo registraste. Solo se envía cuando esa misma cuenta inicia sesión.",
        "Si otra persona inicia sesión en la misma computadora con otra cuenta o contra otro servidor, no envía tu cola y esos servicios no aparecen en su tablero; siguen guardados hasta que vuelvas a entrar con tu cuenta."
      ],
      "callout": {
        "kind": "warning",
        "title": "Antes de cambiar de cuenta",
        "body": "Sincroniza antes de cerrar sesión. Así no dejas servicios o pagos esperando en la computadora."
      }
    }
  ],
  "walkthrough": {
    "id": "carspa-sin-conexion",
    "title": "Trabajar sin conexión",
    "image": "/manual/img/carspa-sin-conexion.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 4,
        "caption": "Sin internet puedes seguir creando servicios.",
        "image": "/manual/img/carspa-sin-conexion.webp",
        "highlight": {
          "x": 56.1,
          "y": 2.7,
          "w": 22.0,
          "h": 5.2
        },
        "cursor": {
          "x": 67.1,
          "y": 5.3,
          "click": false
        }
      },
      {
        "at": 4,
        "dur": 4,
        "caption": "La tarjeta nueva muestra «Pendiente de sync» y el ticket se imprime igual.",
        "highlight": {
          "x": 20.1,
          "y": 77.0,
          "w": 9.8,
          "h": 5.2
        },
        "cursor": {
          "x": 25.0,
          "y": 79.6,
          "click": false
        }
      },
      {
        "at": 8,
        "dur": 4,
        "caption": "Cuando vuelve la conexión, pulsa «Sincronizar».",
        "highlight": {
          "x": 77.4,
          "y": 1.8,
          "w": 10.4,
          "h": 7.0
        },
        "cursor": {
          "x": 82.6,
          "y": 5.3,
          "click": true
        }
      },
      {
        "at": 12,
        "dur": 5,
        "caption": "Si el servidor rechaza una operación, la tarjeta muestra «Error de sync».",
        "image": "/manual/img/carspa-sin-conexion-error.webp",
        "highlight": {
          "x": 28.7,
          "y": 73.6,
          "w": 7.7,
          "h": 5.2
        },
        "cursor": {
          "x": 32.5,
          "y": 76.2,
          "click": false
        }
      }
    ]
  }
};

export default chapter;
