import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "pos-cobro",
  "order": 301,
  "group": "Punto de venta",
  "title": "Cobrar, vuelto y ventas en espera",
  "summary": "Cobra en efectivo, con tarjeta u otro medio, divide el pago y pon ventas en espera para atender a otro cliente.",
  "sections": [
    {
      "id": "efectivo",
      "title": "Cobrar en efectivo y dar vuelto",
      "body": [
        "Pulsa Cobrar (F2). La ventana «Cobrar $…» propone Efectivo como método y el total de la venta."
      ],
      "steps": [
        "Escribe en «Efectivo recibido» lo que te entregó el cliente, o toca uno de los botones rápidos (monto exacto, el siguiente entero, múltiplo de $5 o de $10).",
        "La ventana calcula el Vuelto. Si el efectivo recibido es menor al total, muestra el faltante y no deja confirmar.",
        "Si dejas «Efectivo recibido» vacío se entiende pago exacto.",
        "Pulsa «Confirmar pago»."
      ],
      "figure": {
        "src": "/manual/img/pos-cobro-efectivo.webp",
        "alt": "Ventana de cobro en efectivo con efectivo recibido y vuelto",
        "caption": "Cobro en efectivo con vuelto."
      },
      "callout": {
        "kind": "info",
        "title": "Redondeo y vuelto máximo",
        "body": "Si en Impresora de tickets activas el redondeo al múltiplo de $0.05, solo se aplica cuando toda la venta se paga con un único pago en efectivo. El vuelto no puede pasar de $1,000: más que eso se trata como un error de digitación, por ejemplo un código de barras escrito en el campo."
      }
    },
    {
      "id": "tarjeta",
      "title": "Cobrar con tarjeta u otro método",
      "body": [
        "En «Método de pago» elige Tarjeta (datáfono) u Otro. Con Tarjeta, la caja no cobra por sí misma: cobras en tu datáfono y aquí dejas constancia."
      ],
      "steps": [
        "Elige el Tipo de tarjeta (VISA, MASTERCARD, AMEX u OTRO).",
        "Si quieres, anota los últimos 4 dígitos, el código de aprobación y la referencia del voucher. Los tres son opcionales.",
        "Confirma el pago. Con tarjeta y con «Otro» se cobra siempre el monto exacto, sin redondeo."
      ],
      "figure": {
        "src": "/manual/img/pos-cobro-tarjeta.webp",
        "alt": "Ventana de cobro con método Tarjeta, tipo, últimos 4 dígitos y código de aprobación",
        "caption": "Datos del voucher de tarjeta."
      },
      "callout": {
        "kind": "warning",
        "title": "Nunca el número completo",
        "body": "La ventana lo recuerda: registra solo los últimos 4 dígitos. El número completo de la tarjeta no se guarda en la caja."
      }
    },
    {
      "id": "dividido",
      "title": "Dividir el pago",
      "body": [
        "Cuando el cliente paga una parte con tarjeta y el resto en efectivo, usa pagos divididos."
      ],
      "steps": [
        "Elige el primer método y escribe en «Monto de este pago» la parte que cubre. Vacío significa todo el saldo.",
        "Pulsa «Agregar pago». Queda una fila en la parte de arriba (con una × para quitarla) y se muestra «Saldo pendiente».",
        "El siguiente método se propone como Efectivo. Registra el resto; cuando el saldo diga «Saldo cubierto» se habilita «Confirmar pago»."
      ],
      "figure": {
        "src": "/manual/img/pos-cobro-dividido.webp",
        "alt": "Pago dividido: una fila de tarjeta por $10.00 y el saldo pendiente por cobrar en efectivo",
        "caption": "Un pago con tarjeta ya agregado y el saldo pendiente."
      },
      "callout": {
        "kind": "info",
        "title": "Sin redondeo en pagos divididos",
        "body": "Los pagos divididos siempre cobran el monto exacto."
      }
    },
    {
      "id": "guardado",
      "title": "Después de cobrar",
      "body": [
        "La venta se guarda como ticket con su número, se descuenta el inventario de los productos que controlan existencias y la Venta actual queda vacía para el siguiente cliente.",
        "Si hay una impresora configurada, el recibo se imprime en segundo plano y los recibos se hacen uno por uno: la caja sigue libre mientras la impresora trabaja. Verás «Ticket … impreso» o, si falló, «guardado — impresión falló» con el motivo; la venta no se pierde. Sin impresora configurada, el aviso es «guardado (sin impresora configurada)».",
        "Si el descuento de inventario falla, el ticket queda guardado y la caja te avisa para que lo revises."
      ],
      "figure": {
        "src": "/manual/img/pos-venta-guardada.webp",
        "alt": "Pantalla de venta vacía con el aviso de ticket guardado sin impresora configurada",
        "caption": "Ticket guardado; la caja queda lista para la siguiente venta."
      }
    },
    {
      "id": "espera",
      "title": "Poner una venta en espera y retomarla",
      "body": [
        "Útil cuando el cliente olvidó algo o llega otro cliente con prisa."
      ],
      "steps": [
        "Con la venta armada, pulsa el botón «F8» (poner en espera) o la tecla F8. Aparece «Venta en espera: #1» y la venta actual se limpia.",
        "El botón «Ventas en espera (n)» de arriba muestra cuántas hay. Ábrelo para ver cada una con su total, fecha y productos.",
        "Pulsa Reanudar: la venta vuelve a la pantalla con la etiqueta «Reanudada». Al cobrarla conserva el mismo número de ticket.",
        "El cubo descarta una venta en espera previa confirmación; queda anulada con el motivo «Venta en espera descartada»."
      ],
      "figure": {
        "src": "/manual/img/pos-en-espera.webp",
        "alt": "Ventana Ventas en espera con dos ventas y botones Reanudar",
        "caption": "Dos ventas en espera listas para reanudar."
      },
      "callout": {
        "kind": "info",
        "title": "Cada caja ve las suyas",
        "body": "Las ventas en espera pertenecen a la caja donde se pusieron en espera. Si pulsas Limpiar con una venta reanudada, sigue guardada en «Ventas en espera»."
      }
    }
  ],
  "walkthrough": {
    "id": "pos-cobro",
    "title": "Cobrar una venta",
    "image": "/manual/img/pos-carrito.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3,
        "caption": "Con la venta lista, pulsa Cobrar (F2).",
        "highlight": {
          "x": 75.4,
          "y": 91.1,
          "w": 21.7,
          "h": 7.6
        },
        "cursor": {
          "x": 86.3,
          "y": 94.9,
          "click": true
        }
      },
      {
        "at": 3,
        "dur": 4,
        "caption": "En efectivo: escribe cuánto te entregó el cliente.",
        "image": "/manual/img/pos-cobro-efectivo.webp",
        "highlight": {
          "x": 37.3,
          "y": 52.3,
          "w": 25.5,
          "h": 6.5
        },
        "cursor": {
          "x": 50.1,
          "y": 55.6
        },
        "type": {
          "x": 38.5,
          "y": 55.6,
          "text": "50"
        }
      },
      {
        "at": 7,
        "dur": 3,
        "caption": "La ventana calcula el vuelto al instante.",
        "highlight": {
          "x": 57.4,
          "y": 63.8,
          "w": 4.5,
          "h": 5.2
        },
        "cursor": {
          "x": 59.7,
          "y": 66.4
        }
      },
      {
        "at": 10,
        "dur": 3.5,
        "caption": "Con tarjeta: cobras en el datáfono y registras tipo, últimos 4 dígitos y aprobación.",
        "image": "/manual/img/pos-cobro-tarjeta.webp",
        "highlight": {
          "x": 37.3,
          "y": 56,
          "w": 25.5,
          "h": 6.5
        },
        "cursor": {
          "x": 50.1,
          "y": 59.3
        },
        "type": {
          "x": 38.5,
          "y": 59.3,
          "text": "4242"
        }
      },
      {
        "at": 13.5,
        "dur": 3.5,
        "caption": "En pagos divididos, cada pago agregado queda en una fila.",
        "image": "/manual/img/pos-cobro-dividido.webp",
        "highlight": {
          "x": 37.3,
          "y": 21.4,
          "w": 25.5,
          "h": 9.4
        },
        "cursor": {
          "x": 50.1,
          "y": 26.1
        }
      },
      {
        "at": 17,
        "dur": 3.5,
        "caption": "Cuando el saldo está cubierto, confirma el pago.",
        "highlight": {
          "x": 53.3,
          "y": 77.7,
          "w": 9.4,
          "h": 9.1
        },
        "cursor": {
          "x": 58,
          "y": 82.3,
          "click": true
        }
      },
      {
        "at": 20.5,
        "dur": 3.5,
        "caption": "Con F8 una venta espera mientras atiendes a otro cliente.",
        "image": "/manual/img/pos-en-espera.webp",
        "highlight": {
          "x": 53.9,
          "y": 45.5,
          "w": 8.8,
          "h": 6
        },
        "cursor": {
          "x": 58.3,
          "y": 48.5
        }
      },
      {
        "at": 24,
        "dur": 3.5,
        "caption": "El ticket queda guardado y la caja libre para el siguiente.",
        "image": "/manual/img/pos-venta-guardada.webp",
        "highlight": {
          "x": 18.9,
          "y": 24.2,
          "w": 47.8,
          "h": 6.5
        },
        "cursor": {
          "x": 42.8,
          "y": 27.5
        },
        "toast": "Ticket guardado"
      }
    ]
  }
};

export default chapter;
