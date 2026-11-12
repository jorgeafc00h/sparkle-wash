import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "pos-consolidar",
  "order": 304,
  "group": "Punto de venta",
  "title": "Consolidar tickets en una factura",
  "summary": "Convierte muchas ventas de mostrador en un borrador de factura Consumidor Final o Crédito Fiscal.",
  "sections": [
    {
      "id": "como-funciona",
      "title": "Cómo se factura lo vendido en caja",
      "body": [
        "Un ticket del punto de venta no es un documento tributario. La caja no genera un DTE por cada ticket: el camino es Punto de venta → Consolidar (ruta /pos/consolidate), que agrupa varios tickets en un solo borrador de factura. Ese borrador sigue el flujo normal de Facturas: lo revisas, lo firmas y lo envías a Hacienda desde allí.",
        "Consolidar no envía nada a Hacienda. Cuando la factura llega a Completada, los tickets pasan a «Facturado» solos."
      ],
      "callout": {
        "kind": "warning",
        "title": "Requiere plan de pago",
        "body": "En el plan Free la pantalla muestra «Función de plan de pago» con las opciones «Iniciar prueba gratis de 2 meses» y «Ver planes». En el menú, Consolidar aparece con un candado. Vender, tickets y cierres siguen disponibles."
      },
      "figure": {
        "src": "/manual/img/pos-consolidar-bloqueado.webp",
        "alt": "Pantalla Consolidar bloqueada con el aviso de función de plan de pago",
        "caption": "Lo que ve el plan Free."
      }
    },
    {
      "id": "seleccionar",
      "title": "Elegir los tickets",
      "body": [
        "La pantalla abre con un aviso: la factura llevará la fecha de emisión (los DTE no se pueden fechar hacia atrás) y el rango de tickets queda en observaciones. Consulta con tu contador cada cuánto conviene consolidar."
      ],
      "steps": [
        "Ajusta Desde y Hasta (por defecto, el mes en curso). Se listan los tickets completados que aún no están facturados.",
        "Pulsa «Seleccionar todos» o marca los tickets uno por uno. Los ya incluidos en otro borrador no aparecen.",
        "Pulsa «Revisar n tickets»."
      ],
      "figure": {
        "src": "/manual/img/pos-consolidar-seleccion-marcada.webp",
        "alt": "Lista de tickets con cuatro marcados y uno sin marcar",
        "caption": "Cuatro tickets elegidos; el quinto queda pendiente."
      }
    },
    {
      "id": "revisar",
      "title": "Tipo de documento y revisión",
      "body": [
        "En el segundo paso eliges el «Tipo de DTE»: Factura Consumidor Final o Comprobante de Crédito Fiscal. Para el crédito fiscal debes escoger el cliente, y la caja avisa si ese cliente no tiene NRC."
      ],
      "steps": [
        "Revisa la tabla: la caja suma las líneas por producto y precio, con sus descuentos, y calcula IVA incluido y TOTAL.",
        "Si mezclaste tickets normales con otros excluidos de Libros IVA, la caja avisa que generará dos borradores, uno por grupo.",
        "Si el rango abarca varios meses, también te lo advierte."
      ],
      "figure": {
        "src": "/manual/img/pos-consolidar-revision.webp",
        "alt": "Revisión de la consolidación con el tipo de DTE y las líneas agrupadas por producto",
        "caption": "Líneas agrupadas por producto antes de generar el borrador."
      }
    },
    {
      "id": "cuadre",
      "title": "El cuadre y la confirmación",
      "body": [
        "«Cuadre con las ventas del período» enfrenta la factura contra lo vendido: ventas del período, lo que quitaste (con su número de ticket y su monto), devoluciones y anulaciones posteriores, lo incluido, el redondeo de efectivo (que no se factura) y el total del borrador. Debe decir «La factura cuadra con las ventas incluidas» con diferencia $0.00."
      ],
      "steps": [
        "Pulsa «Generar borrador de factura».",
        "La ventana «Confirmar consolidación» resume cuántos tickets, el total y cuáles quedan fuera.",
        "Si hubiera diferencia, debes marcar que la reconoces antes de continuar. Pulsa «Crear borrador».",
        "Aparece «Borradores creados» con el enlace «Abrir factura»."
      ],
      "figure": {
        "src": "/manual/img/pos-consolidar-cuadre.webp",
        "alt": "Cuadre de la consolidación con diferencia de $0.00 y botón Generar borrador",
        "caption": "El cuadre debe terminar en $0.00."
      },
      "callout": {
        "kind": "info",
        "title": "Un ticket pendiente sigue pendiente",
        "body": "Los tickets que dejaste fuera siguen disponibles en la lista para la próxima consolidación. Mientras un ticket esté en un borrador no se puede anular ni devolver."
      }
    },
    {
      "id": "desde-cierre",
      "title": "Facturar un cierre completo",
      "body": [
        "Desde Cierre de caja, el botón «Facturar este cierre» abre esta misma pantalla con todas las ventas de ese Z ya marcadas y un aviso azul con el cierre elegido. Puedes quitar tickets, ver cuáles se quedan fuera y confirmar; el total del borrador debe igualar lo vendido menos el redondeo de efectivo."
      ],
      "figure": {
        "src": "/manual/img/pos-consolidar-creada.webp",
        "alt": "Aviso de borrador creado con cuatro tickets y enlace Abrir factura",
        "caption": "Borrador creado: se abre desde Abrir factura."
      }
    }
  ],
  "walkthrough": {
    "id": "pos-consolidar",
    "title": "De tickets a un borrador de factura",
    "image": "/manual/img/pos-consolidar-seleccion.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3.5,
        "caption": "Lee el aviso: la factura llevará la fecha de emisión.",
        "highlight": {
          "x": 18.9,
          "y": 12.8,
          "w": 79.8,
          "h": 12.9
        },
        "cursor": {
          "x": 58.8,
          "y": 19.3
        }
      },
      {
        "at": 3.5,
        "dur": 3.5,
        "caption": "Elige el rango de fechas y selecciona los tickets.",
        "highlight": {
          "x": 44.1,
          "y": 29.8,
          "w": 12.7,
          "h": 6
        },
        "cursor": {
          "x": 50.5,
          "y": 32.8,
          "click": true
        }
      },
      {
        "at": 7,
        "dur": 3.5,
        "caption": "Desmarca los que quieras dejar para después.",
        "image": "/manual/img/pos-consolidar-seleccion-marcada.webp",
        "highlight": {
          "x": 21.3,
          "y": 42.1,
          "w": 1.8,
          "h": 3.3
        },
        "cursor": {
          "x": 22.2,
          "y": 43.8,
          "click": true
        }
      },
      {
        "at": 10.5,
        "dur": 3.5,
        "caption": "Pulsa Revisar tickets.",
        "highlight": {
          "x": 56.8,
          "y": 29.3,
          "w": 11.1,
          "h": 6.5
        },
        "cursor": {
          "x": 62.4,
          "y": 32.6,
          "click": true
        }
      },
      {
        "at": 14,
        "dur": 3.5,
        "caption": "Escoge el tipo de DTE y revisa las líneas agrupadas.",
        "image": "/manual/img/pos-consolidar-revision.webp",
        "highlight": {
          "x": 31.4,
          "y": 29.3,
          "w": 17.3,
          "h": 6.5
        },
        "cursor": {
          "x": 40.1,
          "y": 32.6
        }
      },
      {
        "at": 17.5,
        "dur": 3.5,
        "caption": "El cuadre debe terminar en $0.00.",
        "image": "/manual/img/pos-consolidar-cuadre.webp",
        "highlight": {
          "x": 20.4,
          "y": 83.7,
          "w": 76.7,
          "h": 4.2
        },
        "cursor": {
          "x": 58.8,
          "y": 85.8
        }
      },
      {
        "at": 21,
        "dur": 3.5,
        "caption": "Genera el borrador y ábrelo desde Abrir factura.",
        "image": "/manual/img/pos-consolidar-creada.webp",
        "highlight": {
          "x": 90.8,
          "y": 32,
          "w": 6.6,
          "h": 4.2
        },
        "cursor": {
          "x": 94.1,
          "y": 34.1
        },
        "toast": "Borrador creado"
      }
    ]
  }
};

export default chapter;
