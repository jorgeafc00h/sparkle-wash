import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "impresoras",
  "order": 170,
  "group": "Car Spa",
  "title": "Impresoras y tickets",
  "summary": "Configura la impresora térmica y prueba los tickets de trabajo y de venta.",
  "sections": [
    {
      "id": "config",
      "title": "Configurar la impresora",
      "body": [
        "Los tickets se imprimen en una impresora térmica de tickets. Se configura en Configuración → Impresora de tickets."
      ],
      "steps": [
        "Activa «Habilitar impresora de tickets».",
        "En «Conexión» elige «USB — cola de impresión del sistema» (instala antes el driver de la impresora y pulsa «Actualizar» para detectarla) o «Red (Ethernet / Wi-Fi) — IP, puerto 9100» e indica la IP.",
        "Elige el ancho de papel: 80 mm o 58 mm.",
        "Ajusta «Copias» (1 a 3), «Cortar papel» y, si tu impresora lo tiene, «Abrir caja registradora».",
        "Pulsa «Guardar». Con «Imprimir página de prueba» y «Diagnosticar» (revisa si la impresora responde en esa IP y puerto) compruebas que todo funciona."
      ],
      "figure": {
        "src": "/manual/img/carspa-impresora.webp",
        "alt": "Pantalla Impresora de Tickets con la casilla Habilitar impresora, la conexión, el ancho de papel y las copias."
      }
    },
    {
      "id": "prueba",
      "title": "Probar el ticket de trabajo",
      "body": [
        "En Configuración → Car Spa (lavado), el botón «Imprimir ticket de prueba» envía un ticket de ejemplo y muestra debajo una vista previa en texto. Si no hay impresora configurada, solo se muestra la vista previa.",
        "Ahí mismo cambias el pie del ticket y las copias por ticket de trabajo, y si se imprime automáticamente al crear un servicio."
      ],
      "figure": {
        "src": "/manual/img/carspa-caja-tickets.webp",
        "alt": "Configuración de Car Spa con los botones Guardar e Imprimir ticket de prueba."
      }
    },
    {
      "id": "tipos",
      "title": "Qué imprime Car Spa",
      "body": [
        "El ticket de trabajo (ORDEN DE TRABAJO) se imprime al crear un servicio y al reimprimirlo desde la tarjeta. Los tickets de venta de la caja se imprimen con la misma impresora; no son facturas ni documentos fiscales."
      ]
    }
  ],
  "walkthrough": {
    "id": "carspa-impresoras",
    "title": "Impresoras y tickets",
    "image": "/manual/img/carspa-impresora.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 4,
        "caption": "Abre Configuración → Impresora de tickets.",
        "image": "/manual/img/carspa-impresora.webp",
        "highlight": {
          "x": 20.1,
          "y": 15.4,
          "w": 2.6,
          "h": 4.3
        },
        "cursor": {
          "x": 21.4,
          "y": 17.6,
          "click": false
        }
      },
      {
        "at": 4,
        "dur": 4,
        "caption": "Activa «Habilitar impresora de tickets».",
        "highlight": {
          "x": 20.1,
          "y": 15.4,
          "w": 2.6,
          "h": 4.3
        },
        "cursor": {
          "x": 21.4,
          "y": 17.6,
          "click": true
        }
      },
      {
        "at": 8,
        "dur": 5,
        "caption": "Elige la conexión: USB (cola del sistema) o red, y el ancho de papel.",
        "highlight": {
          "x": 20.1,
          "y": 22.8,
          "w": 27.7,
          "h": 7.5
        },
        "cursor": {
          "x": 34.0,
          "y": 26.6,
          "click": false
        }
      },
      {
        "at": 13,
        "dur": 4,
        "caption": "Define las copias y si corta el papel.",
        "highlight": {
          "x": 20.1,
          "y": 53.3,
          "w": 18.7,
          "h": 7.5
        },
        "cursor": {
          "x": 29.5,
          "y": 57.0,
          "click": false
        }
      },
      {
        "at": 17,
        "dur": 4,
        "caption": "Vuelve a Car Spa (lavado) y prueba con «Imprimir ticket de prueba».",
        "image": "/manual/img/carspa-caja-tickets.webp",
        "highlight": {
          "x": 28.0,
          "y": 84.2,
          "w": 17.2,
          "h": 7.0
        },
        "cursor": {
          "x": 36.6,
          "y": 87.7,
          "click": true
        }
      }
    ]
  }
};

export default chapter;
