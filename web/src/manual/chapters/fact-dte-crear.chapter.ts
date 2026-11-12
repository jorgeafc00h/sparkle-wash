import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "fact-dte-crear",
  "order": 202,
  "group": "Facturación electrónica",
  "title": "Documentos tributarios: crear, editar y buscar",
  "summary": "Consulta la lista de DTE, crea un documento en dos pasos (tipo, datos y líneas) y edita los borradores antes de enviarlos.",
  "sections": [
    {
      "id": "lista",
      "title": "La lista «DTE y Eventos»",
      "body": [
        "Facturas, en la barra lateral, abre la lista de documentos de la empresa activa. Cada fila muestra el Nº Control, la fecha, el tipo, el cliente, el total y el estado. Tocar una fila abre el detalle del documento.",
        "La barra superior permite buscar por número de control, cliente, tipo, código de generación, sello de recepción o DTE de origen. A su derecha hay tres filtros: Todos, Documentos o Eventos; un tipo concreto (Factura, CCF, Nota de Crédito…) y un estado (Nueva, Sincronizando, Completada, Anulada, Modificada, Error envío o Contingencia). Si el control de usuarios locales está activo, también aparece la columna Creado por y su filtro.",
        "Marca varias filas con las casillas, o usa Seleccionar todas, y aparece el botón Eliminar con el número de borradores marcados. Solo se eliminan los documentos en estado Nueva o Error: lo que Hacienda ya procesó, o una factura invalidada, se conserva. Antes de borrar un documento con error, la app consulta a Hacienda por si ya lo había aceptado."
      ],
      "figure": {
        "src": "/manual/img/fact-dte-lista.webp",
        "alt": "Lista de DTE y eventos con búsqueda, filtros por tipo y estado y los botones Contingencia y Nuevo DTE o Evento",
        "caption": "La lista de DTE y eventos."
      },
      "callout": {
        "kind": "info",
        "title": "Límite del plan gratuito",
        "body": "En el plan Free, las empresas de producción pueden crear hasta 10 documentos o eventos por mes; un contador lo muestra sobre la lista y, al llegar al límite, se ofrece Ver planes. Las empresas de pruebas (Desarrollo) y los documentos vinculados a otro, como las notas de crédito, no cuentan."
      }
    },
    {
      "id": "tipo",
      "title": "Paso 1: elige el tipo de documento",
      "body": [
        "Pulsa Nuevo DTE o Evento. Primero eliges qué vas a emitir. Los Documentos DTE son comprobantes ordinarios para ventas, compras, ajustes y traslados; los Eventos MH/DTE son registros para informar sucesos a Hacienda y no reemplazan una factura. Cada tipo se explica en el capítulo siguiente."
      ],
      "figure": {
        "src": "/manual/img/fact-dte-tipo.webp",
        "alt": "Paso 1 de Nuevo DTE o Evento con las tarjetas de cada tipo de documento",
        "caption": "Paso 1: las tarjetas de tipos de documento."
      }
    },
    {
      "id": "datos",
      "title": "Paso 2: fecha, cliente, condición de pago e ítems",
      "body": [
        "El segundo paso cambia un poco según el tipo, pero casi siempre incluye estos bloques."
      ],
      "steps": [
        "Fecha: viene con la fecha de hoy de El Salvador. Cámbiala si el documento corresponde a otro día.",
        "Cliente: escribe para buscar por nombre, razón social, NIT o DUI. Las flechas y Enter eligen una opción de la lista de resultados.",
        "Condición de pago (Factura, CCF y Exportación): 1 Contado, 2 Crédito o 3 Otro. En crédito se indican plazo y período. En contado puedes marcar Registrar saldo pendiente para dejar una cuenta por cobrar con su fecha de vencimiento.",
        "Ítems: pulsa Agregar ítem, escribe el nombre de un producto del catálogo o describe el servicio a mano, y ajusta cantidad, precio y, en los tipos que lo permiten, el descuento por línea. Los botones 5%, 10%, 15% y 20% aplican el mismo descuento a todas las líneas.",
        "Revisa el cuadro Totales de la derecha, que se recalcula con cada cambio, y pulsa Guardar DTE."
      ],
      "figure": {
        "src": "/manual/img/fact-dte-cliente.webp",
        "alt": "Buscador de cliente con la lista de resultados desplegada en el formulario de una factura",
        "caption": "Buscar al cliente por nombre o documento."
      }
    },
    {
      "id": "guardar",
      "title": "Guardar es todavía no enviar",
      "body": [
        "Guardar DTE deja el documento como borrador, con estado Nueva y su número de control ya asignado. Aparece el aviso «DTE creado correctamente» y vuelves a la lista. El envío a Hacienda se hace después, desde el detalle del documento (capítulo «Enviar, firmar y estados»).",
        "Si el guardado falla, la app restaura lo que habías escrito y aparece un botón Deshacer por si necesitas recuperar los datos del formulario."
      ],
      "figure": {
        "src": "/manual/img/fact-dte-nuevo.webp",
        "alt": "Formulario de una factura con dos ítems, el cuadro de totales y el botón Guardar DTE",
        "caption": "Formulario completo, con totales y el botón Guardar DTE."
      }
    },
    {
      "id": "editar",
      "title": "Editar un borrador",
      "body": [
        "Solo se pueden editar los documentos en estado Nueva o Error de envío. Entra al detalle y pulsa Editar. La pantalla es la misma del paso 2: fecha, cliente, condición de pago, documento relacionado cuando aplica, ítems y totales; al terminar pulsa Actualizar Factura. Un documento ya completado no se edita: si hay un error, se corrige con una nota de crédito o con un evento de invalidación."
      ],
      "figure": {
        "src": "/manual/img/fact-dte-editar.webp",
        "alt": "Pantalla Editar de un borrador con el botón Actualizar Factura",
        "caption": "Edición de un borrador."
      }
    }
  ],
  "walkthrough": {
    "id": "fact-dte-crear-walkthrough",
    "title": "Crear una factura en tres pasos",
    "image": "/manual/img/fact-dte-lista.webp",
    "aspect": 1.778,
    "steps": [
      {
        "at": 0.5,
        "dur": 3,
        "caption": "En Facturas, pulsa Nuevo DTE o Evento.",
        "highlight": {
          "x": 83.8,
          "y": 2.3,
          "w": 14.9,
          "h": 6.5
        },
        "cursor": {
          "x": 91.3,
          "y": 5.6,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 3,
        "caption": "Paso 1: elige el tipo de documento; aquí, Factura CF.",
        "image": "/manual/img/fact-dte-tipo.webp",
        "highlight": {
          "x": 18.9,
          "y": 23.7,
          "w": 19.7,
          "h": 16.9
        },
        "cursor": {
          "x": 28.8,
          "y": 32.2,
          "click": true
        }
      },
      {
        "at": 6.5,
        "dur": 4,
        "caption": "Escribe el nombre del cliente y elígelo de la lista.",
        "image": "/manual/img/fact-dte-cliente.webp",
        "highlight": {
          "x": 45.5,
          "y": 28.5,
          "w": 24.8,
          "h": 6.5
        },
        "cursor": {
          "x": 57.9,
          "y": 31.8
        },
        "type": {
          "x": 57.9,
          "y": 31.8,
          "text": "Mar"
        }
      },
      {
        "at": 10.5,
        "dur": 3,
        "caption": "Agrega ítems del catálogo: cantidad y precio se completan solos.",
        "image": "/manual/img/fact-dte-nuevo.webp",
        "highlight": {
          "x": 18.9,
          "y": 63.5,
          "w": 52.9,
          "h": 36.5
        }
      },
      {
        "at": 13.5,
        "dur": 3,
        "caption": "Los precios incluyen IVA; los totales separan subtotal e IVA en cada cambio.",
        "highlight": {
          "x": 72.7,
          "y": 15.1,
          "w": 26,
          "h": 27.5
        }
      },
      {
        "at": 16.5,
        "dur": 3,
        "caption": "Pulsa Guardar DTE: el documento queda como borrador.",
        "highlight": {
          "x": 72.7,
          "y": 43.1,
          "w": 26,
          "h": 7.6
        },
        "cursor": {
          "x": 85.7,
          "y": 46.9,
          "click": true
        }
      },
      {
        "at": 19.5,
        "dur": 3,
        "caption": "El borrador aparece en la lista con estado Nueva.",
        "image": "/manual/img/fact-dte-guardado.webp",
        "toast": "DTE creado correctamente."
      }
    ]
  }
};

export default chapter;
