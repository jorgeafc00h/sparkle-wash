import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "cobrar",
  "order": 150,
  "group": "Car Spa",
  "title": "Cobrar un lavado en la caja",
  "summary": "Lleva un servicio a la caja, cobra y deja el pago registrado en Car Spa.",
  "sections": [
    {
      "id": "elegir",
      "title": "Llevar el servicio a la caja",
      "body": [
        "Hay dos caminos para cobrar un lavado:"
      ],
      "steps": [
        "Desde el tablero: pulsa «Cobrar» en la tarjeta. Se abre la caja con ese servicio ya en el carrito.",
        "Desde la caja: abre «Nueva venta», pulsa «Lavados por cobrar (N)» y elige el servicio con «Agregar $…». El botón cambia a «En la venta» cuando ya está en el carrito."
      ],
      "figure": {
        "src": "/manual/img/carspa-pos-por-cobrar.webp",
        "alt": "Lista Lavados por cobrar en la caja con el botón Agregar para cada servicio."
      },
      "callout": {
        "kind": "info",
        "title": "Qué lista aparece",
        "body": "Si arriba ves «Caja sin abrir», pulsa «Abrir caja» e indica el fondo inicial para cuadrar el efectivo al cierre. Se listan los servicios no cancelados con saldo pendiente. Los servicios de antes de que existiera el control de pagos se consideran ya cobrados y no aparecen."
      }
    },
    {
      "id": "carrito",
      "title": "La línea del lavado",
      "body": [
        "El servicio entra como una línea «Lavado <paquete> — <placa>» por su saldo pendiente, con cantidad fija de uno. Puedes agregar otros productos a la misma venta."
      ],
      "figure": {
        "src": "/manual/img/carspa-pos-carrito.webp",
        "alt": "Caja con la línea Lavado Essential Spa en el carrito y el botón Cobrar."
      }
    },
    {
      "id": "pago",
      "title": "Cobrar",
      "body": [
        "Pulsa «Cobrar (F2)». La ventana de pago pide el «Método de pago» (por ejemplo, Efectivo) y el «Monto de este pago»; si lo dejas vacío se cobra todo el saldo. En efectivo escribes el «Efectivo recibido» y la aplicación calcula el «Vuelto».",
        "Para dividir el cobro, escribe en «Monto de este pago» solo una parte y pulsa «Agregar pago»; repite con otro método hasta cubrir el total y confirma con «Confirmar pago».",
        "Al confirmar, el ticket de venta se guarda y la aplicación registra el pago en el servicio, usando el número del ticket como referencia. Si la venta mezcla métodos, el servicio registra el que cubre la mayor parte.",
        "Si la venta se guarda pero el pago no logra registrarse en el servicio, aparece un aviso («Ticket … guardado, pero el pago del lavado no se registró») y la venta no se pierde."
      ],
      "figure": {
        "src": "/manual/img/carspa-pos-pago.webp",
        "alt": "Ventana Cobrar con método de pago Efectivo, monto, efectivo recibido, vuelto y los botones Agregar pago y Confirmar pago."
      }
    },
    {
      "id": "estado-pago",
      "title": "Pagado, Abono y Por cobrar",
      "body": [
        "En el tablero, cada tarjeta muestra «Por cobrar $» mientras no tenga pagos, «Abono $» si recibió un pago menor al precio y «Pagado» cuando el total quedó cubierto.",
        "Si un servicio tiene un abono, la caja ofrece solo el saldo que falta. El contador «Por cobrar» del tablero cuenta los servicios con saldo pendiente."
      ],
      "figure": {
        "src": "/manual/img/carspa-tablero-cobrado.webp",
        "alt": "Tablero después del cobro, con el servicio terminado marcado como Pagado."
      }
    }
  ],
  "walkthrough": {
    "id": "carspa-cobrar",
    "title": "Cobrar un lavado",
    "image": "/manual/img/carspa-pos-por-cobrar.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 4,
        "caption": "Abre «Nueva venta» y pulsa «Lavados por cobrar».",
        "image": "/manual/img/carspa-pos-por-cobrar.webp",
        "highlight": {
          "x": 32.2,
          "y": 28.7,
          "w": 35.6,
          "h": 50.8
        },
        "cursor": {
          "x": 50.0,
          "y": 54.1,
          "click": false
        }
      },
      {
        "at": 4,
        "dur": 4,
        "caption": "Pulsa «Agregar $» junto al servicio: entra a la venta por su saldo.",
        "highlight": {
          "x": 32.2,
          "y": 28.7,
          "w": 35.6,
          "h": 9.5
        },
        "cursor": {
          "x": 50.0,
          "y": 33.5,
          "click": true
        }
      },
      {
        "at": 8,
        "dur": 4,
        "caption": "La línea «Lavado …» ya está en el carrito. Pulsa «Cobrar».",
        "image": "/manual/img/carspa-pos-carrito.webp",
        "highlight": {
          "x": 75.1,
          "y": 66.8,
          "w": 22.5,
          "h": 8.6
        },
        "cursor": {
          "x": 86.3,
          "y": 71.1,
          "click": true
        }
      },
      {
        "at": 12,
        "dur": 5,
        "caption": "Registra el pago. Con «Agregar pago» puedes dividirlo.",
        "image": "/manual/img/carspa-pos-pago.webp",
        "highlight": {
          "x": 36.9,
          "y": 51.8,
          "w": 26.2,
          "h": 7.5
        },
        "cursor": {
          "x": 50.0,
          "y": 55.5,
          "click": false
        }
      },
      {
        "at": 17,
        "dur": 4,
        "caption": "Confirma el pago. El ticket se guarda.",
        "highlight": {
          "x": 53.0,
          "y": 72.3,
          "w": 10.1,
          "h": 10.2
        },
        "cursor": {
          "x": 58.0,
          "y": 77.4,
          "click": true
        },
        "toast": "Ticket guardado"
      },
      {
        "at": 21,
        "dur": 5,
        "caption": "En el tablero, el servicio pasa a «Pagado».",
        "image": "/manual/img/carspa-tablero-cobrado.webp",
        "highlight": {
          "x": 20.1,
          "y": 46.2,
          "w": 5.5,
          "h": 5.2
        },
        "cursor": {
          "x": 22.9,
          "y": 48.8,
          "click": false
        }
      }
    ]
  }
};

export default chapter;
