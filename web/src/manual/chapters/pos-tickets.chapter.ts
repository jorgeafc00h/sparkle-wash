import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "pos-tickets",
  "order": 302,
  "group": "Punto de venta",
  "title": "Tickets, reimpresión y devoluciones",
  "summary": "Consulta las ventas del día, reimprime un recibo, devuelve productos o anula una venta.",
  "sections": [
    {
      "id": "lista",
      "title": "El historial de tickets",
      "body": [
        "Punto de venta → Tickets (ruta /pos/tickets) lista las ventas de la caja. Por defecto muestra el día de hoy: cambia Desde y Hasta para otro rango y usa Estado para ver solo Abiertos, Completados, Anulados o Facturados. El encabezado suma lo vendido en el rango.",
        "Cada fila muestra el número del ticket, su estado, la fecha, las líneas, el método de pago y el cajero, y a la derecha tres iconos: reimprimir, devolución y anular. Un ticket con devoluciones lleva una marca roja; uno excluido de Libros IVA, «fuera de libros»."
      ],
      "figure": {
        "src": "/manual/img/pos-tickets-lista.webp",
        "alt": "Lista de tickets del día con estado, método de pago, cajero y botones de reimpresión, devolución y anulación",
        "caption": "Historial de tickets del día."
      }
    },
    {
      "id": "detalle",
      "title": "Ver el detalle y reimprimir",
      "body": [
        "Haz clic en la fila para abrir el detalle: líneas, descuento, redondeo si lo hubo, IVA incluido, total, forma de pago y, si existen, las devoluciones con el NETO que se quedó."
      ],
      "steps": [
        "Pulsa Reimprimir (en el detalle o con el icono de la fila).",
        "El recibo sale marcado como reimpresión / copia y nunca abre la gaveta de dinero.",
        "Si no hay impresora configurada o falla, la caja lo dice con «No se pudo reimprimir» y el motivo."
      ],
      "figure": {
        "src": "/manual/img/pos-ticket-detalle.webp",
        "alt": "Detalle de un ticket con líneas, descuento, IVA incluido y total",
        "caption": "Detalle de un ticket con los botones Devolución y Reimprimir."
      }
    },
    {
      "id": "devolucion",
      "title": "Devolver productos (total o parcial)",
      "body": [
        "Úsala cuando el cliente regresa uno o varios productos de un ticket ya cobrado."
      ],
      "steps": [
        "Pulsa Devolución en el ticket. La ventana lista cada producto con lo Vendido, lo Devuelto y una casilla A devolver.",
        "Escribe cuántas unidades regresan (las de peso aceptan decimales). «Devolver todo lo que queda» llena todas las casillas. El Reembolso se calcula solo e incluye la parte proporcional del descuento.",
        "Elige «Reembolsar con»: Efectivo, Tarjeta (reverso en el datáfono) u Otro, y escribe el Motivo, que es obligatorio.",
        "Pulsa «Registrar devolución». Las unidades vuelven al inventario una sola vez, se imprime un «Comprobante de devolución» no fiscal (si hay impresora) y el detalle muestra Devoluciones y NETO."
      ],
      "figure": {
        "src": "/manual/img/pos-devolucion.webp",
        "alt": "Ventana de devolución con una unidad a devolver, método de reembolso y motivo",
        "caption": "Devolución parcial: una unidad de tres."
      },
      "callout": {
        "kind": "warning",
        "title": "Cuándo no se puede devolver",
        "body": "La devolución no está disponible si el ticket ya está facturado o forma parte de un borrador de factura (ahí se trabaja con nota de crédito), si ya se devolvió todo, o si tu usuario no tiene el permiso «Devoluciones»."
      }
    },
    {
      "id": "anular",
      "title": "Anular un ticket",
      "body": [
        "Anular sirve para un error de cobro: cancela la venta completa y restituye el inventario. No se puede deshacer."
      ],
      "steps": [
        "Pulsa el icono Anular de la fila (o el botón en el detalle).",
        "Escribe el Motivo (obligatorio) y confirma con «Anular ticket».",
        "El ticket pasa a Anulado y deja de contar en el cierre de caja."
      ],
      "figure": {
        "src": "/manual/img/pos-anular.webp",
        "alt": "Ventana Anular ticket con el motivo Error de cobro",
        "caption": "Anulación con motivo."
      },
      "callout": {
        "kind": "warning",
        "title": "Tickets en un borrador de factura",
        "body": "Un ticket que ya está en un borrador de factura no se puede anular: la caja pide eliminar el borrador o quitar el ticket de la consolidación primero. Anular y devolver son permisos aparte del permiso para abrir Tickets."
      }
    }
  ],
  "walkthrough": {
    "id": "pos-tickets",
    "title": "Devolver un producto",
    "image": "/manual/img/pos-tickets-lista.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3.5,
        "caption": "Filtra por fechas y estado; la fila muestra método de pago y cajero.",
        "highlight": {
          "x": 17.1,
          "y": 12.8,
          "w": 82.9,
          "h": 12.9
        },
        "cursor": {
          "x": 58.6,
          "y": 19.3
        }
      },
      {
        "at": 3.5,
        "dur": 3.5,
        "caption": "Haz clic en el ticket para ver su detalle.",
        "image": "/manual/img/pos-ticket-detalle.webp",
        "highlight": {
          "x": 33.2,
          "y": 27.5,
          "w": 33.7,
          "h": 44.9
        },
        "cursor": {
          "x": 50.1,
          "y": 50,
          "click": true
        }
      },
      {
        "at": 7,
        "dur": 3.5,
        "caption": "En el detalle, pulsa Devolución.",
        "highlight": {
          "x": 46.7,
          "y": 63.9,
          "w": 9.4,
          "h": 6
        },
        "cursor": {
          "x": 51.4,
          "y": 66.9,
          "click": true
        }
      },
      {
        "at": 10.5,
        "dur": 3.5,
        "caption": "Escribe cuántas unidades regresan.",
        "image": "/manual/img/pos-devolucion.webp",
        "highlight": {
          "x": 58.5,
          "y": 41.4,
          "w": 6.7,
          "h": 5.5
        },
        "cursor": {
          "x": 61.9,
          "y": 44.2
        },
        "type": {
          "x": 59.7,
          "y": 44.2,
          "text": "1"
        }
      },
      {
        "at": 14,
        "dur": 3.5,
        "caption": "Anota el motivo y elige cómo reembolsar.",
        "highlight": {
          "x": 50,
          "y": 62.4,
          "w": 23.3,
          "h": 6.5
        },
        "cursor": {
          "x": 61.7,
          "y": 65.7
        },
        "type": {
          "x": 51.2,
          "y": 65.7,
          "text": "Paño con defecto de fábrica"
        }
      },
      {
        "at": 17.5,
        "dur": 3.5,
        "caption": "Registra la devolución: el reembolso se calcula solo.",
        "highlight": {
          "x": 57.3,
          "y": 71.6,
          "w": 16,
          "h": 6.5
        },
        "cursor": {
          "x": 65.3,
          "y": 74.9,
          "click": true
        }
      },
      {
        "at": 21,
        "dur": 3.5,
        "caption": "El ticket muestra lo devuelto y el NETO.",
        "image": "/manual/img/pos-devolucion-hecha.webp",
        "highlight": {
          "x": 34.6,
          "y": 49.2,
          "w": 30.7,
          "h": 4.2
        },
        "cursor": {
          "x": 50,
          "y": 51.3
        },
        "toast": "Devolución registrada"
      }
    ]
  }
};

export default chapter;
