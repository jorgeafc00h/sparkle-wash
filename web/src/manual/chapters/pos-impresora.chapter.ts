import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "pos-impresora",
  "order": 305,
  "group": "Punto de venta",
  "title": "Impresora térmica del recibo",
  "summary": "Conecta la impresora de tickets, ajusta el recibo, el redondeo y la regla de existencias, y prueba que todo funciona.",
  "sections": [
    {
      "id": "habilitar",
      "title": "Conectar la impresora",
      "body": [
        "Entra por el botón Impresora de la pantalla de venta o por Configuración → Impresora de tickets (ruta /settings/printer). La impresión térmica ESC/POS funciona en la aplicación de escritorio; en un navegador solo puedes ver la vista previa. El perfil probado es Epson TM-T20II de 80 mm; también sirven impresoras ESC/POS genéricas de 58 u 80 mm."
      ],
      "steps": [
        "Marca «Habilitar impresora de tickets». Si Windows ya tiene una cola USB de tickets, la caja la propone.",
        "En «Conexión» elige USB — cola de impresión del sistema, o Red (Ethernet / Wi-Fi) con la IP y el puerto (normalmente 9100).",
        "Para USB, elige la Cola de impresión; si no aparece, instala el driver de la impresora, conéctala y pulsa «Actualizar».",
        "Elige el Ancho de papel: 80 mm (48 columnas) o 58 mm."
      ],
      "figure": {
        "src": "/manual/img/pos-impresora-config.webp",
        "alt": "Configuración de impresora con conexión USB, ancho de papel, cola, encabezado y pie",
        "caption": "Impresora USB configurada con encabezado y pie propios."
      }
    },
    {
      "id": "recibo",
      "title": "Qué lleva el recibo",
      "body": [
        "El recibo incluye el nombre comercial, NIT, dirección y teléfono de la empresa, tu «Encabezado extra» (una línea, por ejemplo «¡Gracias por su visita!»), el número de ticket, el cajero y el cliente si los hay, las líneas con descuentos, redondeo, total, IVA incluido, el detalle de cada pago (para tarjeta: tipo, últimos 4 y aprobación) y tu «Pie de página». Si no escribes un pie, se imprime «Factura disponible a solicitud.»",
        "En el mismo formulario ajustas Copias, «Cortar papel» y «Abrir caja registradora» (solo para impresoras que tengan puerto de gaveta; la TM-T20II no lo tiene). La gaveta se abre al cobrar en efectivo, nunca al reimprimir."
      ],
      "callout": {
        "kind": "info",
        "title": "No es un documento fiscal",
        "body": "El recibo de la caja es un comprobante de venta, no un DTE. Para facturar lo vendido usa Consolidar. La página de prueba lo dice: «Documento no fiscal — no es factura ni DTE»."
      }
    },
    {
      "id": "reglas",
      "title": "Redondeo y venta sin existencias",
      "body": [
        "Estas dos reglas viven en la misma pantalla y afectan al cobro."
      ],
      "steps": [
        "«Redondeo de efectivo»: Exacto (sin redondeo) o Al múltiplo de $0.05 más cercano. Aplica solo a ventas pagadas con un único pago en efectivo.",
        "«Venta sin stock»: Bloquear (recomendado) impide cobrar más de lo que hay; Permitir y registrar faltante deja vender y anota el faltante.",
        "Pulsa Guardar. «Descartar cambios» vuelve a lo guardado."
      ]
    },
    {
      "id": "probar",
      "title": "Probar y diagnosticar",
      "body": [
        "Con la impresora guardada pulsa «Imprimir página de prueba». La Vista previa de abajo muestra cómo se ve el papel con tu ancho de columnas.",
        "Si no imprime, usa «Diagnosticar» en el cuadro «Diagnóstico de conexión». No imprime nada: revisa paso a paso, para USB, el servicio de cola de impresión, la cola, el puerto, el estado y los trabajos atascados; para red, si la impresora responde en esa IP y puerto, y te dice dónde falla."
      ],
      "figure": {
        "src": "/manual/img/pos-impresora-diagnostico.webp",
        "alt": "Diagnóstico de conexión con cuatro pasos correctos y la vista previa del recibo",
        "caption": "Diagnóstico correcto de una impresora USB."
      },
      "callout": {
        "kind": "warning",
        "title": "Si no sale papel y el ticket se guardó",
        "body": "El ticket se guarda aunque la impresión falle. Corrige la impresora y reimprime desde Tickets. Si persiste, abre un ticket de soporte desde Configuración con la categoría «Impresión de tickets» (ver capítulo Asistente y soporte)."
      }
    }
  ],
  "walkthrough": {
    "id": "pos-impresora",
    "title": "Dejar lista la impresora",
    "image": "/manual/img/pos-impresora-apagada.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3.5,
        "caption": "Marca Habilitar impresora de tickets.",
        "highlight": {
          "x": 20.4,
          "y": 16,
          "w": 1.8,
          "h": 3.3
        },
        "cursor": {
          "x": 21.3,
          "y": 17.7,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 3.5,
        "caption": "Elige conexión USB o red y el ancho de papel.",
        "image": "/manual/img/pos-impresora-config.webp",
        "highlight": {
          "x": 20.4,
          "y": 23.3,
          "w": 27,
          "h": 6.5
        },
        "cursor": {
          "x": 33.9,
          "y": 26.6
        }
      },
      {
        "at": 7,
        "dur": 3.5,
        "caption": "Añade un encabezado propio al recibo.",
        "highlight": {
          "x": 20.4,
          "y": 46.7,
          "w": 27,
          "h": 6.5
        },
        "cursor": {
          "x": 33.9,
          "y": 50
        },
        "type": {
          "x": 21.6,
          "y": 50,
          "text": "¡Gracias por su visita!"
        }
      },
      {
        "at": 10.5,
        "dur": 3.5,
        "caption": "Define el redondeo de efectivo y la regla de existencias.",
        "highlight": {
          "x": 20.4,
          "y": 67.1,
          "w": 27,
          "h": 6.5
        },
        "cursor": {
          "x": 33.9,
          "y": 70.4
        },
        "zoom": {
          "x": 12.3,
          "y": 58.2,
          "w": 43.2,
          "h": 24.3
        }
      },
      {
        "at": 14,
        "dur": 3.5,
        "caption": "Guarda y envía la página de prueba.",
        "highlight": {
          "x": 27.3,
          "y": 75.3,
          "w": 17.7,
          "h": 6.5
        },
        "cursor": {
          "x": 36.2,
          "y": 78.6,
          "click": true
        }
      },
      {
        "at": 17.5,
        "dur": 3.5,
        "caption": "Si algo falla, Diagnosticar revisa la conexión paso a paso.",
        "image": "/manual/img/pos-impresora-diagnostico.webp",
        "highlight": {
          "x": 20.4,
          "y": 54.3,
          "w": 54,
          "h": 35
        },
        "cursor": {
          "x": 47.4,
          "y": 71.8
        }
      }
    ]
  }
};

export default chapter;
