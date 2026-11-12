import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "fact-invalidar-contingencia",
  "order": 205,
  "group": "Facturación electrónica",
  "title": "Invalidar un documento y reportar contingencia",
  "summary": "Deja sin efecto un DTE ya aceptado con un evento de invalidación, y reporta a Hacienda los documentos emitidos cuando no había conexión.",
  "sections": [
    {
      "id": "invalidar-cuando",
      "title": "Cuándo se puede invalidar",
      "body": [
        "Un evento de invalidación deja sin efecto ante Hacienda un DTE ya emitido. Se abre con el botón rojo Evento de invalidación del detalle de un documento Completada. La pantalla resume los identificadores que se copiarán al evento: tipo de DTE, número de control, código de generación, sello de recepción y fecha de emisión.",
        "Para poder invalidar, el documento debe estar Completada, tener número de control, código de generación y sello de recepción, y no haber sido invalidado antes. Además hay un plazo: Facturas (01), Exportación (11) y Sujeto Excluido (14) pueden invalidarse hasta 3 meses después de transmitidas; los demás tipos (CCF, notas, retención, liquidación, donación y eventos) hasta el décimo día hábil del mes siguiente.",
        "Cuando se puede, un cuadro ámbar muestra «Plazo hasta» con los días y horas restantes. Cuando no, un cuadro rojo dice «No se puede registrar» y explica el motivo, por ejemplo que el plazo venció."
      ],
      "figure": {
        "src": "/manual/img/fact-invalidar-bloqueado.webp",
        "alt": "Pantalla de evento de invalidación de un CCF antiguo con el aviso No se puede registrar porque venció el plazo",
        "caption": "Un CCF fuera de plazo: la pantalla explica por qué no se puede registrar."
      },
      "callout": {
        "kind": "warning",
        "title": "Invalidar no se deshace",
        "body": "Un evento de invalidación registrado en Hacienda no se puede revertir. Si solo hay un error en un CCF, valora una nota de crédito en lugar de invalidarlo."
      }
    },
    {
      "id": "invalidar-pasos",
      "title": "Registrar el evento",
      "body": [
        "El formulario pide el motivo y los datos de quien responde. Con el motivo 1 debes indicar qué documento lo sustituye."
      ],
      "steps": [
        "Elige el Motivo: 1 Error en la información del DTE a invalidar, 2 Rescindir de la operación realizada, o 3 Otro.",
        "Con el motivo 1, escribe el Código de generación del DTE correcto: el UUID v4 del documento que reemplaza al invalidado. Con el motivo 3, escribe el motivo con al menos 5 caracteres.",
        "Escribe el Nombre del responsable y su Documento (DUI, NIT o pasaporte).",
        "Pulsa Registrar Evento de invalidación.",
        "Si Hacienda lo acepta aparece «Evento de invalidación registrado correctamente.», el documento pasa a Anulada y el inventario que descontó se reingresa. Si algo falla, el mensaje de error se muestra y el documento no cambia."
      ],
      "figure": {
        "src": "/manual/img/fact-invalidar-form.webp",
        "alt": "Formulario de evento de invalidación con el motivo, el código del DTE sustituto y los datos del responsable",
        "caption": "Formulario con motivo 1: pide el código del DTE que sustituye."
      }
    },
    {
      "id": "contingencia",
      "title": "Contingencia: reportar documentos emitidos sin conexión",
      "body": [
        "Cuando no pudiste transmitir uno o más DTE por problemas de conectividad, fallas del sistema o fuerza mayor, la pantalla Solicitud de Contingencia reporta a Hacienda el evento y envía los documentos afectados juntos. Se abre con el botón Contingencia de la lista de Facturas, o al usar Marcar como contingencia en un borrador.",
        "Solo se pueden incluir documentos en estado Nueva, Error o Contingencia, de los tipos que Hacienda permite emitir en contingencia: Factura, CCF, Nota de Remisión, Nota de Crédito, Nota de Débito, Comprobante de Retención, Exportación y Sujeto Excluido. Un evento admite hasta 1000 documentos."
      ],
      "steps": [
        "En Período de Contingencia, elige Fecha inicio, Fecha fin, Hora inicio y Hora fin. La fecha de inicio debe ser anterior o igual a la de fin.",
        "Pulsa Cargar Facturas. La lista Facturas Disponibles muestra los documentos del rango, todos marcados; desmarca los que no quieras incluir o usa Seleccionar todo.",
        "En Detalles de la Contingencia elige el Tipo de contingencia (1 No disponibilidad del sistema del MH, 2 Sin conectividad con el MH, 3 Falla eléctrica, 4 Falla en las comunicaciones del emisor, 5 Otros motivos).",
        "Escribe el Nombre del responsable, su DUI (exactamente 9 dígitos) y el Motivo de la contingencia.",
        "Pulsa Enviar Solicitud y Sincronizar. Primero se envía el reporte y luego cada documento; la pantalla muestra el avance y una lista de Resultados."
      ],
      "figure": {
        "src": "/manual/img/fact-contingencia-lista.webp",
        "alt": "Lista de facturas disponibles para contingencia, todas marcadas, y el formulario de detalles debajo",
        "caption": "Los documentos cargados del período y el formulario de detalles."
      },
      "callout": {
        "kind": "info",
        "title": "Qué pasa con cada documento",
        "body": "Los documentos aceptados pasan a Completada con su sello; los que Hacienda rechaza quedan en Error para corregirlos y reenviarlos. Si el reporte en sí no se pudo enviar, ningún documento cambia de estado."
      }
    }
  ],
  "walkthrough": {
    "id": "fact-invalidar-contingencia-walkthrough",
    "title": "Invalidar un documento y reportar contingencia",
    "image": "/manual/img/fact-invalidar-resumen.webp",
    "aspect": 1.778,
    "steps": [
      {
        "at": 0.5,
        "dur": 4,
        "caption": "La pantalla muestra el plazo y los identificadores del documento que se invalidará.",
        "highlight": {
          "x": 20.4,
          "y": 51.2,
          "w": 76.7,
          "h": 22.7
        }
      },
      {
        "at": 4.5,
        "dur": 3,
        "caption": "Elige el motivo; con el motivo 1 se pide el código del DTE sustituto.",
        "image": "/manual/img/fact-invalidar-form.webp",
        "highlight": {
          "x": 20.4,
          "y": 67.1,
          "w": 36.4,
          "h": 6.5
        },
        "cursor": {
          "x": 38.6,
          "y": 70.4,
          "click": true
        }
      },
      {
        "at": 7.5,
        "dur": 4,
        "caption": "Escribe el código de generación del documento correcto.",
        "highlight": {
          "x": 20.4,
          "y": 77.2,
          "w": 36.4,
          "h": 6.5
        },
        "cursor": {
          "x": 38.6,
          "y": 80.5
        },
        "type": {
          "x": 38.6,
          "y": 80.5,
          "text": "33333333-3333-4333-8333-333333333333"
        }
      },
      {
        "at": 11.5,
        "dur": 3,
        "caption": "Indica quién responde: nombre y documento.",
        "highlight": {
          "x": 60.8,
          "y": 67.1,
          "w": 36.4,
          "h": 6.5
        },
        "cursor": {
          "x": 79,
          "y": 70.4
        }
      },
      {
        "at": 14.5,
        "dur": 3,
        "caption": "Pulsa Registrar Evento de invalidación.",
        "highlight": {
          "x": 18.9,
          "y": 92.7,
          "w": 23,
          "h": 7.3
        },
        "cursor": {
          "x": 30.4,
          "y": 96.4,
          "click": true
        },
        "toast": "Evento de invalidación registrado correctamente."
      },
      {
        "at": 17.5,
        "dur": 4,
        "caption": "Si emitiste sin conexión, en Contingencia elige el período y carga las facturas.",
        "image": "/manual/img/fact-contingencia-inicio.webp",
        "highlight": {
          "x": 30.2,
          "y": 2.3,
          "w": 57.1,
          "h": 97.7
        },
        "cursor": {
          "x": 38.3,
          "y": 66.5,
          "click": true
        }
      },
      {
        "at": 21.5,
        "dur": 3,
        "caption": "Completa los datos del responsable y envía la solicitud.",
        "image": "/manual/img/fact-contingencia-detalles.webp",
        "highlight": {
          "x": 63.9,
          "y": 92.7,
          "w": 23.5,
          "h": 7.3
        },
        "cursor": {
          "x": 75.7,
          "y": 96.4,
          "click": true
        }
      }
    ]
  }
};

export default chapter;
