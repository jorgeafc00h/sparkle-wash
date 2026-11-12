import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "pos-vender",
  "order": 300,
  "group": "Punto de venta",
  "title": "Vender en la caja",
  "summary": "Busca o escanea productos, ajusta cantidades y descuentos y deja la venta lista para cobrar.",
  "sections": [
    {
      "id": "pantalla",
      "title": "La pantalla de venta",
      "body": [
        "Entra por Punto de venta → Nueva venta (ruta /pos). A la izquierda está la búsqueda, los filtros por categoría y la cuadrícula de productos, cada uno con su precio y su existencia. A la derecha está la Venta actual: líneas, descuentos, totales y el botón Cobrar.",
        "Arriba hay cinco botones: Ventas en espera, Caja (configuración de esta caja), Impresora (configuración de impresión), Lavados por cobrar y Limpiar (vacía la venta actual). El cobro de lavados se explica en los capítulos de Car Spa; aquí solo se trata la venta de mostrador.",
        "Vender, imprimir el recibo y hacer el cierre de caja funcionan en todos los planes; lo que exige un plan de pago es consolidar tickets en una factura."
      ],
      "figure": {
        "src": "/manual/img/pos-registro-vacio.webp",
        "alt": "Pantalla de venta vacía con búsqueda, cuadrícula de productos y venta actual",
        "caption": "Pantalla de venta antes de agregar productos."
      },
      "callout": {
        "kind": "info",
        "title": "Los precios ya incluyen IVA",
        "body": "En la caja los precios son finales. Los totales se muestran como Subtotal (IVA incl.), IVA incluido y TOTAL, no se suma impuesto aparte."
      }
    },
    {
      "id": "buscar",
      "title": "Buscar, escanear y agregar productos",
      "body": [
        "Hay tres formas de agregar un producto, y puedes combinarlas durante la misma venta."
      ],
      "steps": [
        "Haz clic en un producto de la cuadrícula. Si ya está en la venta, se suma una unidad a su línea.",
        "O escribe en la búsqueda parte del nombre, el código interno o el código de barras. La cuadrícula se filtra mientras escribes; con las categorías (Todas, Limpieza, Accesorios…) acotas más.",
        "Pulsa Enter para agregar la coincidencia exacta de un código de barras o código interno. Verás el aviso «Agregado: …».",
        "Con un lector de código de barras no necesitas hacer clic en la búsqueda: el lector escribe el código muy rápido y termina con Enter, y la caja lo reconoce en cualquier parte de la pantalla (códigos de 5 caracteres o más).",
        "Para varias unidades escribe la cantidad seguida de asterisco antes del código, por ejemplo 3* y luego escanea o pulsa un producto. Aparece el aviso «Cantidad para el próximo producto: 3»."
      ],
      "figure": {
        "src": "/manual/img/pos-multiplicador.webp",
        "alt": "Búsqueda con 3* escrito y el aviso de cantidad para el próximo producto",
        "caption": "Con 3* en la búsqueda, el próximo producto se agrega ×3."
      },
      "callout": {
        "kind": "warning",
        "title": "Sin existencia no se vende (por defecto)",
        "body": "Si pides más unidades de las que hay, la caja avisa «Stock insuficiente» y no cobra. En Impresora de tickets puedes cambiar «Venta sin stock» a «Permitir y registrar faltante»."
      }
    },
    {
      "id": "cantidades",
      "title": "Cantidades, descuentos y cliente",
      "body": [
        "Cada línea de la Venta actual tiene botones − y +, un campo de cantidad, un campo de descuento en porcentaje y un cubo para quitarla (también con la tecla F4 sobre la línea seleccionada).",
        "Los productos por unidad aceptan solo cantidades enteras. Los que se venden por peso, volumen o longitud (kilogramo, litro, galón, metro…) aceptan hasta 3 decimales; si escribes una fracción en un producto por unidad, la caja la rechaza con un mensaje y deja la cantidad como estaba.",
        "El descuento de línea es un porcentaje de esa línea y se recalcula si cambias la cantidad. El descuento de todo el ticket tiene botones rápidos de 5 %, 10 %, 15 % y 20 % o un porcentaje que escribes; nunca pasa de 100 %.",
        "Cliente (opcional) lleva el nombre a mostrar en el ticket; vacío se entiende como Consumidor final. La casilla «Excluir de Libros IVA al consolidar» solo aparece si tu usuario tiene acceso a Libros IVA."
      ],
      "figure": {
        "src": "/manual/img/pos-carrito.webp",
        "alt": "Venta actual con cuatro líneas, un descuento de línea del 10 %, descuento del ticket del 5 % y el total",
        "caption": "Venta con descuentos: la línea de cera lleva 10 % y el ticket 5 %."
      },
      "callout": {
        "kind": "info",
        "title": "Quién ve cada venta",
        "body": "Si el control de usuarios está activo, el cajero que cobra queda anotado en el ticket como «Cajero: …»."
      }
    },
    {
      "id": "codigo-nuevo",
      "title": "Un código que no existe: crear el producto al vuelo",
      "body": [
        "Si escaneas o escribes un código que no está en el catálogo, la caja avisa «Código no encontrado» y muestra una franja con el botón Crear producto."
      ],
      "steps": [
        "Pulsa Crear producto. El código de barras ya viene escrito.",
        "Escribe el Nombre y el Precio (IVA incluido). Elige Impuesto y Unidad si no son los habituales.",
        "Marca «Controlar inventario» solo si quieres llevar existencias y entonces indica la Existencia inicial.",
        "Pulsa «Guardar y agregar»: el producto se crea en el catálogo y entra directo en la venta. Con Cerrar descartas el aviso."
      ],
      "figure": {
        "src": "/manual/img/pos-crear-rapido.webp",
        "alt": "Ventana Crear producto con código de barras, nombre y precio",
        "caption": "Creación rápida de un producto durante la venta."
      },
      "callout": {
        "kind": "info",
        "title": "Solo para quien administra productos",
        "body": "El botón Crear producto aparece únicamente para el administrador o para usuarios con permiso de Productos. Si el precio es cero o el código de barras ya existe, la ventana lo señala y no guarda."
      }
    },
    {
      "id": "balanza",
      "title": "Etiquetas de balanza y caja con varios puestos",
      "body": [
        "Pulsa Caja para abrir «Configuración de caja». Allí le das un Nombre y un Código a esta computadora (hasta 4 letras o números, por ejemplo C1). Con código, los tickets se numeran C1-000123; sin código se ven como #000123. Si tienes más de una caja, dale un código distinto a cada una.",
        "Si tu tienda tiene balanza que imprime etiquetas EAN-13 con peso o precio, activa «Leer etiquetas de balanza». Indica el Prefijo (normalmente 2), qué trae la etiqueta (peso en gramos o precio), cuántos dígitos tiene el PLU y cuántos el valor. La ventana muestra un ejemplo para comprobar que coincide con tus etiquetas.",
        "Al escanear una etiqueta, la caja busca el producto cuyo código o código de barras sea igual al PLU (sin importar los ceros a la izquierda). Si la etiqueta trae peso, la cantidad se convierte a kilogramos (a gramos o libras si el producto se vende en esas unidades); si trae precio, la cantidad es precio ÷ precio unitario. Cada etiqueta queda en su propia línea. El dígito verificador se valida: una etiqueta mal leída no agrega nada."
      ],
      "figure": {
        "src": "/manual/img/pos-config-caja.webp",
        "alt": "Configuración de caja con nombre, código y etiquetas de balanza activadas",
        "caption": "Configuración de caja: nombre, código y lectura de etiquetas de balanza."
      },
      "callout": {
        "kind": "warning",
        "title": "PLU sin producto",
        "body": "Si el PLU de la etiqueta no coincide con ningún producto activo, la caja muestra «Código no encontrado: PLU n (etiqueta de balanza)» y ofrece crear un producto en kilogramos."
      }
    },
    {
      "id": "atajos",
      "title": "Atajos de teclado",
      "body": [
        "F2 abre el cobro. F4 quita la línea seleccionada (la última que tocaste). F8 pone la venta en espera. Los atajos se ignoran mientras hay una ventana abierta, para no cobrar ni quitar nada por error."
      ]
    }
  ],
  "walkthrough": {
    "id": "pos-vender",
    "title": "Una venta en la caja",
    "image": "/manual/img/pos-registro-vacio.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3.5,
        "caption": "Escribe o escanea en la búsqueda: nombre, código interno o código de barras.",
        "highlight": {
          "x": 18.9,
          "y": 24.2,
          "w": 47.8,
          "h": 6.5
        },
        "cursor": {
          "x": 42.8,
          "y": 27.5,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 3.5,
        "caption": "Antes de escanear puedes escribir 3* para llevar tres unidades del siguiente producto.",
        "image": "/manual/img/pos-multiplicador.webp",
        "highlight": {
          "x": 18.9,
          "y": 30.7,
          "w": 47.8,
          "h": 3.6
        },
        "cursor": {
          "x": 42.8,
          "y": 32.5
        },
        "type": {
          "x": 20.1,
          "y": 32.5,
          "text": "3*"
        }
      },
      {
        "at": 7,
        "dur": 3.5,
        "caption": "Cada producto agregado aparece como una línea de la Venta actual.",
        "image": "/manual/img/pos-carrito.webp",
        "highlight": {
          "x": 68.5,
          "y": 31.1,
          "w": 28.7,
          "h": 28.1
        },
        "cursor": {
          "x": 82.9,
          "y": 45.2
        }
      },
      {
        "at": 10.5,
        "dur": 3.5,
        "caption": "La etiqueta de balanza deja su propia línea con el peso en kilogramos.",
        "highlight": {
          "x": 68.5,
          "y": 51.8,
          "w": 28.4,
          "h": 7.4
        },
        "cursor": {
          "x": 82.7,
          "y": 55.5
        }
      },
      {
        "at": 14,
        "dur": 3.5,
        "caption": "Cada línea acepta su porcentaje de descuento.",
        "highlight": {
          "x": 85,
          "y": 38.4,
          "w": 5,
          "h": 5.5
        },
        "cursor": {
          "x": 87.5,
          "y": 41.2,
          "click": true
        }
      },
      {
        "at": 17.5,
        "dur": 3.5,
        "caption": "Y el ticket completo, con botones rápidos de 5, 10, 15 o 20 %.",
        "highlight": {
          "x": 91.6,
          "y": 59.2,
          "w": 5.6,
          "h": 5.5
        },
        "cursor": {
          "x": 94.4,
          "y": 62,
          "click": true
        }
      },
      {
        "at": 21,
        "dur": 3.5,
        "caption": "Revisa el total y pulsa Cobrar (o F2).",
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
      }
    ]
  }
};

export default chapter;
