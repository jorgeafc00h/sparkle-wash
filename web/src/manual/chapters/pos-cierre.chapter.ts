import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "pos-cierre",
  "order": 303,
  "group": "Punto de venta",
  "title": "Caja abierta, arqueo y cierre Z",
  "summary": "Abre la caja con un fondo, registra entradas y salidas de efectivo, revisa el corte X y cierra el día con el corte Z.",
  "sections": [
    {
      "id": "abrir",
      "title": "Abrir la caja con un fondo inicial",
      "body": [
        "Al entrar a la venta, una franja amarilla dice «Caja sin abrir». El fondo inicial es el efectivo con el que arrancas para dar vuelto; sirve para que el cierre cuadre."
      ],
      "steps": [
        "Pulsa «Abrir caja».",
        "Cuenta el efectivo y escribe el Fondo inicial en dólares.",
        "Pulsa «Abrir caja». La franja pasa a «Caja abierta desde … · Fondo $50.00»."
      ],
      "figure": {
        "src": "/manual/img/pos-caja-abrir.webp",
        "alt": "Ventana Abrir caja con un fondo inicial de 50",
        "caption": "Apertura de caja con fondo inicial."
      },
      "callout": {
        "kind": "info",
        "title": "Es opcional, pero conviene",
        "body": "Puedes vender sin abrir la caja. En ese caso el arqueo del cierre parte de un fondo de $0.00."
      }
    },
    {
      "id": "movimientos",
      "title": "Entradas y salidas de efectivo",
      "body": [
        "Con la caja abierta aparece el botón «Entradas y salidas». Úsalo cuando metes o sacas dinero que no es una venta."
      ],
      "steps": [
        "Elige el Tipo: Entrada (cambio, depósito) o Salida.",
        "Escribe el Monto (mayor que cero) y el Motivo, por ejemplo «Pago a proveedor de agua». Ambos son obligatorios.",
        "Pulsa Registrar. El movimiento suma o resta en el arqueo del cierre."
      ],
      "figure": {
        "src": "/manual/img/pos-caja-movimiento.webp",
        "alt": "Ventana Entradas y salidas de efectivo con tipo, monto y motivo",
        "caption": "Registro de un movimiento de efectivo."
      },
      "callout": {
        "kind": "info",
        "title": "Permiso aparte",
        "body": "Registrar entradas y salidas es un permiso de acción (Entradas/salidas de efectivo). Sin él, el botón aparece bloqueado con una explicación."
      }
    },
    {
      "id": "x-z",
      "title": "Corte X y corte Z",
      "body": [
        "Punto de venta → Cierre de caja (ruta /pos/closing) tiene dos modos y se abre en Z — cierre. X — lectura es una consulta: muestra las ventas del rango Desde–Hasta, también de todas las cajas si lo eliges en «Cajas», y no guarda nada. Z — cierre cierra el período de esta caja: reúne todo lo vendido desde el cierre Z anterior hasta ahora (o desde el principio si es el primero) y guarda una fotografía con los tickets incluidos.",
        "El resumen cuenta Tickets, Anulados, Descuentos otorgados, IVA incluido y VENTA TOTAL. Al lado verás las ventas Por método de pago, Por cajero y Por producto. Si hubo devoluciones o se anuló una venta de un cierre anterior, aparecen restadas en «NETO DEL CIERRE»."
      ],
      "figure": {
        "src": "/manual/img/pos-cierre-x.webp",
        "alt": "Cierre de caja en modo Z con resumen, método de pago, cajero y producto",
        "caption": "Resumen del período antes de cerrar."
      }
    },
    {
      "id": "arqueo",
      "title": "Arqueo de efectivo y cerrar el día",
      "body": [
        "El arqueo compara el efectivo que debería haber con el que cuentas."
      ],
      "steps": [
        "En el cuadro «Arqueo de efectivo» revisa: Fondo inicial + Ventas en efectivo − Devoluciones en efectivo + Entradas − Salidas = Efectivo esperado.",
        "Cuenta la gaveta y escribe el monto en «Efectivo contado ($)». La pantalla muestra Faltante o Sobrante al instante.",
        "Pulsa «Cerrar del día (Z)» (con impresora configurada, «… e imprimir»). Aparece «Cierre Z registrado».",
        "El Z cierra también la sesión de caja: la franja vuelve a «Caja sin abrir» y el siguiente turno abre con su propio fondo."
      ],
      "figure": {
        "src": "/manual/img/pos-cierre-arqueo.webp",
        "alt": "Arqueo de efectivo con efectivo esperado, efectivo contado de 84 y un faltante",
        "caption": "Arqueo con un faltante de $12.80."
      },
      "callout": {
        "kind": "warning",
        "title": "Vende después de un Z sin miedo",
        "body": "El Z cubre hasta el momento en que lo haces. Las ventas posteriores entran en el siguiente cierre; ninguna queda sin cerrar."
      }
    },
    {
      "id": "historial",
      "title": "Cierres anteriores y facturar un cierre",
      "body": [
        "Al final de la pantalla, «Cierres anteriores» lista cada Z con su fecha, cantidad de tickets, el total y el arqueo (esperado, contado y faltante o sobrante). El botón «Facturar este cierre» abre la consolidación con las ventas de ese cierre ya marcadas (ver capítulo siguiente)."
      ],
      "figure": {
        "src": "/manual/img/pos-cierre-historial.webp",
        "alt": "Lista de cierres anteriores con el botón Facturar este cierre",
        "caption": "Un cierre Z guardado con su botón Facturar este cierre."
      }
    }
  ],
  "walkthrough": {
    "id": "pos-cierre",
    "title": "Del fondo al cierre Z",
    "image": "/manual/img/pos-caja-cerrada.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3,
        "caption": "La caja empieza «sin abrir». Pulsa Abrir caja.",
        "highlight": {
          "x": 90.4,
          "y": 16.5,
          "w": 7.3,
          "h": 6
        },
        "cursor": {
          "x": 94.1,
          "y": 19.5,
          "click": true
        }
      },
      {
        "at": 3,
        "dur": 3.5,
        "caption": "Cuenta el efectivo y escribe el fondo inicial.",
        "image": "/manual/img/pos-caja-abrir.webp",
        "highlight": {
          "x": 37.3,
          "y": 50.9,
          "w": 25.5,
          "h": 6.5
        },
        "cursor": {
          "x": 50.1,
          "y": 54.2
        },
        "type": {
          "x": 38.5,
          "y": 54.2,
          "text": "50"
        }
      },
      {
        "at": 6.5,
        "dur": 3.5,
        "caption": "Para meter o sacar dinero que no es una venta, usa Entradas y salidas con su motivo.",
        "image": "/manual/img/pos-caja-movimiento.webp",
        "highlight": {
          "x": 32.6,
          "y": 52.6,
          "w": 34.8,
          "h": 6.5
        },
        "cursor": {
          "x": 50,
          "y": 55.9
        },
        "type": {
          "x": 33.8,
          "y": 55.9,
          "text": "Pago a proveedor de agua"
        }
      },
      {
        "at": 10,
        "dur": 3.5,
        "caption": "La pantalla se abre en Z (cierre). Cambia a X para solo consultar.",
        "image": "/manual/img/pos-cierre-x.webp",
        "highlight": {
          "x": 18.9,
          "y": 21.6,
          "w": 15.5,
          "h": 6.5
        },
        "cursor": {
          "x": 26.7,
          "y": 24.9,
          "click": true
        }
      },
      {
        "at": 13.5,
        "dur": 3.5,
        "caption": "Cuenta la gaveta y escribe el efectivo contado.",
        "image": "/manual/img/pos-cierre-arqueo.webp",
        "highlight": {
          "x": 20.4,
          "y": 67.1,
          "w": 12.6,
          "h": 6.5
        },
        "cursor": {
          "x": 26.7,
          "y": 70.4
        },
        "type": {
          "x": 21.6,
          "y": 70.4,
          "text": "84"
        }
      },
      {
        "at": 17,
        "dur": 3.5,
        "caption": "La pantalla compara contra el efectivo esperado.",
        "highlight": {
          "x": 20.4,
          "y": 60.8,
          "w": 36.7,
          "h": 4.2
        },
        "cursor": {
          "x": 38.8,
          "y": 62.9
        }
      },
      {
        "at": 20.5,
        "dur": 3.5,
        "caption": "Cierra del día (Z): queda guardado en el historial.",
        "image": "/manual/img/pos-cierre-historial.webp",
        "highlight": {
          "x": 20.4,
          "y": 90.2,
          "w": 76.7,
          "h": 9.8
        },
        "cursor": {
          "x": 58.8,
          "y": 95.1
        },
        "toast": "Cierre Z registrado"
      }
    ]
  }
};

export default chapter;
