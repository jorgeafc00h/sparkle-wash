import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "fact-productos",
  "order": 208,
  "group": "Facturación electrónica",
  "title": "Productos e inventario",
  "summary": "Administra tu catálogo de productos y servicios, su categoría fiscal y el inventario, incluido el ajuste de existencias.",
  "sections": [
    {
      "id": "lista",
      "title": "Catálogo de productos",
      "body": [
        "Productos, en la barra lateral, muestra el catálogo con nombre, código (y código de barras si lo tiene), precio, unidad, categoría fiscal, stock y estado. Cuatro tarjetas resumen el inventario: Productos, Stock bajo, Agotados y Valor inventario (costo, según el costo registrado).",
        "Busca por nombre, código o código de barras; filtra con los botones Todos, Stock bajo, Agotados y Servicios, o con el desplegable de Categoría. En la columna Stock, un producto con inventario muestra En stock, Stock bajo o Sin stock; los servicios y productos sin control de inventario muestran un guion o «No controlado»."
      ],
      "figure": {
        "src": "/manual/img/fact-productos-lista.webp",
        "alt": "Lista de productos con tarjetas de resumen de inventario, filtros y columna de stock",
        "caption": "Catálogo con resumen de inventario y estados de stock."
      }
    },
    {
      "id": "formulario",
      "title": "Crear o editar un producto",
      "body": [
        "Agregar Producto (o Editar desde el detalle) abre el formulario. Lo mínimo es el nombre, el precio, la unidad de medida y la categoría fiscal."
      ],
      "steps": [
        "Opcional: Agregar foto (JPG o PNG; se reduce automáticamente para sincronizar entre dispositivos).",
        "Marca «Es un servicio (no lleva inventario)» si corresponde.",
        "Escribe el Nombre del Producto, el Código / SKU, el Código de barras (se puede escanear) y la Descripción.",
        "Elige la Categoría o crea una con «+ Nueva categoría…».",
        "Escribe el Precio Unitario ($), la Unidad de Medida (Unidad, Metro, Kilogramo, Litro, Caja, Docena, Hora, Servicio y otras) y la Categoría Fiscal: Gravado, Exento, No Gravado o Exportación.",
        "Para un producto con existencias, activa Controlar inventario y escribe la Cantidad en Stock y el Umbral Stock Bajo (mínimo 1)."
      ],
      "figure": {
        "src": "/manual/img/fact-productos-form.webp",
        "alt": "Formulario de producto con nombre, código, categoría, precio, unidad y categoría fiscal",
        "caption": "Formulario de producto: la categoría fiscal define cómo se factura."
      },
      "callout": {
        "kind": "info",
        "title": "La categoría fiscal decide la línea",
        "body": "Un producto Exento se factura como venta exenta y uno No Gravado como venta no sujeta, ambos sin IVA. Revisa el capítulo «Tipos de DTE, líneas y retenciones» para saber en qué documentos se aceptan."
      }
    },
    {
      "id": "inventario",
      "title": "Inventario y umbral de stock bajo",
      "body": [
        "Con Controlar inventario activado, el formulario pide la Cantidad en Stock y el Umbral Stock Bajo. Cuando las existencias llegan al umbral el producto pasa a Stock bajo y cuando llegan a cero, a Sin stock; las tarjetas de la lista los cuentan.",
        "El inventario se mueve solo al enviar documentos: al aceptarse una Factura, un CCF, una Exportación o una Nota de Remisión, la app descuenta las cantidades vendidas. Si luego invalidas el documento, las cantidades vuelven al inventario. Las notas de crédito y débito, el sujeto excluido, la donación y otros tipos no mueven existencias."
      ],
      "figure": {
        "src": "/manual/img/fact-productos-inventario.webp",
        "alt": "Bloque Inventario del formulario de producto con cantidad en stock y umbral de stock bajo",
        "caption": "Cantidad en stock y umbral de stock bajo."
      }
    },
    {
      "id": "detalle",
      "title": "Detalle del producto",
      "body": [
        "El detalle muestra las etiquetas Producto o Servicio y Activo o Inactivo, el código, el precio, la unidad, la categoría fiscal, el stock y, si existe, el costo. Los datos de catálogo de Hacienda (tipo de ítem, código de tributo, unidad MH y número de tarifa) aparecen cuando el producto los trae. Editar y Eliminar están arriba; eliminar pide confirmar."
      ],
      "figure": {
        "src": "/manual/img/fact-productos-detalle.webp",
        "alt": "Detalle de un producto con inventario y botón Editar",
        "caption": "Detalle de un producto con inventario."
      }
    },
    {
      "id": "ajuste",
      "title": "Ajuste de inventario",
      "body": [
        "Ajuste de Inventario (botón de la lista) permite corregir existencias de varios productos a la vez. Solo aparecen los productos con inventario controlado; los que están bajo el mínimo muestran «Bajo mínimo»."
      ],
      "steps": [
        "Busca el producto por nombre o código, o filtra por categoría.",
        "En la columna Ajuste usa + y − o escribe la cantidad a agregar o quitar. La columna Nuevo Stock muestra el resultado.",
        "Elige la Razón: Compra, Venta Manual, Ajuste de Inventario, Merma/Pérdida o Devolución.",
        "Revisa el resumen de Productos modificados, Unidades agregadas y Unidades removidas y pulsa Guardar Cambios. Si no cambiaste nada, la app avisa «No hay cambios para guardar»."
      ],
      "figure": {
        "src": "/manual/img/fact-productos-ajuste.webp",
        "alt": "Pantalla Ajuste de Inventario con un producto aumentado en tres unidades y el resumen de cambios",
        "caption": "Ajuste de inventario: +3 unidades en un producto."
      }
    }
  ],
  "walkthrough": {
    "id": "fact-productos-walkthrough",
    "title": "Agregar un producto y ajustar su stock",
    "image": "/manual/img/fact-productos-lista.webp",
    "aspect": 1.778,
    "steps": [
      {
        "at": 0.5,
        "dur": 3,
        "caption": "En Productos, pulsa Agregar Producto.",
        "highlight": {
          "x": 86.8,
          "y": 2.3,
          "w": 11.9,
          "h": 6.5
        },
        "cursor": {
          "x": 92.8,
          "y": 5.6,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 4,
        "caption": "Escribe el nombre y define el precio y la categoría fiscal.",
        "image": "/manual/img/fact-productos-form.webp",
        "highlight": {
          "x": 71.8,
          "y": 91.3,
          "w": 25.4,
          "h": 6.5
        },
        "cursor": {
          "x": 84.5,
          "y": 94.6,
          "click": true
        }
      },
      {
        "at": 7.5,
        "dur": 3,
        "caption": "Con inventario, indica la cantidad en stock y el umbral de aviso.",
        "image": "/manual/img/fact-productos-inventario.webp",
        "highlight": {
          "x": 20.4,
          "y": 84,
          "w": 38.2,
          "h": 6.5
        }
      },
      {
        "at": 10.5,
        "dur": 3,
        "caption": "Guarda el producto con el botón de guardar.",
        "highlight": {
          "x": 86.9,
          "y": 93.8,
          "w": 11.8,
          "h": 6.3
        },
        "cursor": {
          "x": 92.8,
          "y": 97,
          "click": true
        },
        "toast": "Producto creado correctamente."
      },
      {
        "at": 13.5,
        "dur": 3,
        "caption": "Para corregir existencias, abre Ajuste de Inventario.",
        "image": "/manual/img/fact-productos-lista.webp",
        "highlight": {
          "x": 72.3,
          "y": 2.3,
          "w": 14.7,
          "h": 6.5
        },
        "cursor": {
          "x": 79.6,
          "y": 5.6,
          "click": true
        }
      },
      {
        "at": 16.5,
        "dur": 4,
        "caption": "Aumenta o disminuye las cantidades y revisa el nuevo stock.",
        "image": "/manual/img/fact-productos-ajuste.webp",
        "highlight": {
          "x": 18.9,
          "y": 14.3,
          "w": 14.9,
          "h": 6.5
        }
      },
      {
        "at": 20.5,
        "dur": 3,
        "caption": "Pulsa Guardar Cambios para registrar el ajuste.",
        "highlight": {
          "x": 85.1,
          "y": 2.3,
          "w": 13.5,
          "h": 6.5
        },
        "cursor": {
          "x": 91.9,
          "y": 5.6,
          "click": true
        }
      }
    ]
  }
};

export default chapter;
