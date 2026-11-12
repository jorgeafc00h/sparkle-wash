import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "fact-dte-enviar",
  "order": 204,
  "group": "Facturación electrónica",
  "title": "Ver, firmar y enviar un DTE: estados",
  "summary": "Abre el detalle de un documento, envíalo firmado al Ministerio de Hacienda y entiende cada estado y cada acción disponible.",
  "sections": [
    {
      "id": "detalle",
      "title": "El detalle del documento",
      "body": [
        "Al tocar una fila de la lista se abre el detalle. Arriba están el número de control, el código de generación, el tipo y el estado. Debajo: el Receptor, los Ítems, los Totales, la Información General (número de documento y de control) y, cuando Hacienda ya aceptó el documento, el Sello de Recepción MH.",
        "Los botones cambian con el estado. En un borrador (Nueva o Error): Generar cotización, Sincronizar con MH, Editar, Eliminar y Más acciones. En un documento Completada: Vista Previa, Exportar PDF, Enviar por Email, Evento de invalidación y Más acciones. Si el control de usuarios locales está activo, cada botón respeta los permisos del usuario.",
        "Exportar PDF guarda el comprobante; Enviar por Email abre tu cliente de correo con el mensaje listo y te recuerda adjuntar el PDF manualmente."
      ],
      "figure": {
        "src": "/manual/img/fact-enviar-borrador.webp",
        "alt": "Detalle de un borrador con los botones Generar cotización, Sincronizar con MH, Editar, Eliminar y Más acciones",
        "caption": "Detalle de un borrador (estado Nueva)."
      }
    },
    {
      "id": "enviar",
      "title": "Firmar y enviar a Hacienda",
      "body": [
        "Antes de enviar, la empresa necesita su certificado validado y las credenciales de Hacienda guardadas (capítulo «Empresas»). Si falta el certificado el envío se detiene en el primer paso con el aviso «Certificado no configurado»."
      ],
      "steps": [
        "Abre el borrador y pulsa Sincronizar con MH.",
        "Se abre la ventana «Enviando DTE al Ministerio de Hacienda» con cinco pasos: Validando certificado, Preparando DTE, Firmando documento, Enviando al Ministerio de Hacienda y Procesando respuesta. Cada paso muestra su duración al terminar.",
        "Si Hacienda acepta el documento, la ventana se cierra, aparece el aviso «DTE enviado correctamente al Ministerio de Hacienda.», el estado pasa a Completada y el documento recibe su sello de recepción. Los productos con inventario se descuentan en Factura, CCF, Exportación y Nota de Remisión.",
        "Si Hacienda lo rechaza, la ventana queda abierta con el código, el mensaje y el detalle de cada observación. El documento pasa a estado Error, sigue siendo editable y puedes pulsar Reintentar. Si el motivo es que el número de control ya existe, el botón es Regenerar y Reintentar, que crea uno nuevo."
      ],
      "figure": {
        "src": "/manual/img/fact-enviar-rechazo.webp",
        "alt": "Ventana de envío con los cinco pasos y un mensaje de rechazo con el botón Reintentar",
        "caption": "Ejemplo de rechazo con respuesta simulada de Hacienda: se ve el código, el detalle y el botón Reintentar."
      },
      "callout": {
        "kind": "info",
        "title": "En el plan gratuito",
        "body": "Con el plan Free la ventana puede agregar al inicio un paso «Procesando solicitud…» (una espera con anuncio) antes de validar el certificado."
      }
    },
    {
      "id": "estados",
      "title": "Estados de un documento",
      "body": [
        "El estado aparece como etiqueta en la lista, en el detalle y en los filtros.",
        "Nueva: borrador creado, aún no enviado. Se puede editar, enviar, eliminar o marcar como contingencia. Sincronizando: el envío está en curso. Completada: Hacienda lo aceptó y tiene sello; ya no se edita ni se elimina. Anulada: se registró su evento de invalidación. Error (Error envío): el envío falló; sigue siendo borrador y se puede reenviar.",
        "Modificada: el documento aceptado cambió respecto a su creación; la app muestra un aviso para revisar los datos y todavía se puede usar como documento relacionado. Contingencia: el documento se marcó como emitido sin conexión y está pendiente de reportarse (capítulo «Invalidar y contingencia»).",
        "Solo los borradores (Nueva o Error) se pueden eliminar. Antes de borrar uno con error, la app consulta a Hacienda; si ya lo procesó, no lo elimina y te pide reenviarlo para completarlo con su sello."
      ],
      "figure": {
        "src": "/manual/img/fact-dte-lista.webp",
        "alt": "Lista de documentos con estados Nueva, Contingencia, Error, Completada y Anulada",
        "caption": "Los estados en la lista de documentos."
      }
    },
    {
      "id": "acciones",
      "title": "Más acciones",
      "body": [
        "En un CCF completado, Más acciones ofrece Generar Nota de Crédito, Generar Nota de Débito, Generar Nota de Remisión y Generar Comp. Liquidación. En una Factura completada ofrece Nota de Remisión y Comp. Liquidación. Antes de abrir el formulario se pide confirmar. En un DTE 01, 11 o 14 aceptado aparece Registrar Evento de Retorno.",
        "Marcar como contingencia (solo en borradores) deja el documento como emitido bajo contingencia y abre la pantalla de Contingencia con ese documento ya seleccionado. Duplicar factura crea un documento nuevo con los mismos datos."
      ],
      "figure": {
        "src": "/manual/img/fact-enviar-acciones.webp",
        "alt": "Menú Más acciones de un CCF completado con las opciones para generar notas y duplicar",
        "caption": "Menú Más acciones de un CCF completado."
      }
    }
  ],
  "walkthrough": {
    "id": "fact-dte-enviar-walkthrough",
    "title": "Enviar un documento a Hacienda",
    "image": "/manual/img/fact-enviar-borrador.webp",
    "aspect": 1.778,
    "steps": [
      {
        "at": 0.5,
        "dur": 3,
        "caption": "En el detalle de un borrador, pulsa Sincronizar con MH.",
        "highlight": {
          "x": 32.8,
          "y": 17.4,
          "w": 14.5,
          "h": 6.5
        },
        "cursor": {
          "x": 40.1,
          "y": 20.7,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 4,
        "caption": "La app valida el certificado, prepara el DTE, lo firma y lo envía.",
        "image": "/manual/img/fact-enviar-rechazo.webp",
        "highlight": {
          "x": 32.6,
          "y": 28.5,
          "w": 34.8,
          "h": 41.9
        }
      },
      {
        "at": 7.5,
        "dur": 4,
        "caption": "Si Hacienda lo rechaza, verás el código y el detalle, y podrás reintentar.",
        "highlight": {
          "x": 32.6,
          "y": 28.5,
          "w": 34.8,
          "h": 41.9
        }
      },
      {
        "at": 11.5,
        "dur": 4,
        "caption": "Cuando Hacienda lo acepta, el documento queda Completada con su sello.",
        "image": "/manual/img/fact-enviar-completada.webp",
        "highlight": {
          "x": 18.9,
          "y": 25.5,
          "w": 52.9,
          "h": 74.3
        }
      },
      {
        "at": 15.5,
        "dur": 3,
        "caption": "Desde Más acciones puedes generar una nota de crédito sobre un CCF.",
        "image": "/manual/img/fact-enviar-acciones.webp",
        "highlight": {
          "x": 58.5,
          "y": 22.9,
          "w": 22,
          "h": 47.4
        },
        "cursor": {
          "x": 69.5,
          "y": 29.1,
          "click": true
        }
      }
    ]
  }
};

export default chapter;
