import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "fact-dte-tipos",
  "order": 203,
  "group": "Facturación electrónica",
  "title": "Tipos de DTE, líneas y retenciones",
  "summary": "Conoce cada tipo de documento y evento que la app emite, cómo se clasifican las líneas gravadas, exentas y no sujetas, y cuándo aplican retenciones y percepción.",
  "sections": [
    {
      "id": "tipos",
      "title": "Los tipos de documento",
      "body": [
        "En el paso 1 de Nuevo DTE o Evento aparecen estos documentos. El número entre paréntesis es el código de tipo de Hacienda que lleva el número de control.",
        "Factura CF (01): venta a consumidor final. Admite condición de pago, descuentos y líneas gravadas, exentas y no sujetas. CCF (03): comprobante de crédito fiscal para ventas a contribuyentes; mismas opciones que la factura, con el IVA mostrado aparte.",
        "Nota de Crédito (05) y Nota de Débito (06): corrigen o incrementan un CCF ya aceptado. Nota de Remisión (04): traslado de mercancías; pide Nombre y Documento de quien entrega y Observaciones. Comp. Liquidación (08), Retención (07) y Doc. Contable (09): comprobantes de liquidación y de retención de IVA; usan el bloque Documento Relacionado.",
        "Exportación (11): venta al exterior, sin IVA, con condición de pago; el cliente puede llevar los datos de exportación (país y tipo de persona). Sujeto Excluido (14): compra a un sujeto excluido de IVA, sin IVA y con retención de renta opcional. Donación (15): comprobante de donación, sin IVA.",
        "Evento Operaciones Especiales (17): informa a Hacienda operaciones autorizadas con comprobantes de control interno. Pide el tipo de operación (02 factura de venta simplificada o 97 comprobantes de control interno), el número del comprobante y, opcionalmente, su fecha, el código de generación de referencia (UUID v4) y el rango Documento desde y hasta; si llenas un extremo del rango, debes llenar el otro.",
        "Evento de Retorno (18): registra un retorno vinculado a un DTE 01, 11 o 14 ya aceptado. No aparece en el paso 1: se abre desde el detalle de ese documento, con Más acciones y Registrar Evento de Retorno, y copia del DTE de origen el tipo, el número de control, el código de generación, el sello y la fecha."
      ],
      "figure": {
        "src": "/manual/img/fact-dte-eventos.webp",
        "alt": "Paso 1 de Nuevo DTE o Evento con los once documentos DTE y el grupo Eventos MH/DTE",
        "caption": "Documentos DTE y Eventos MH/DTE en el paso 1."
      },
      "callout": {
        "kind": "info",
        "title": "Eventos no son facturas",
        "body": "Los eventos MH/DTE son registros para informar sucesos a Hacienda. No reemplazan la emisión de una factura, un CCF u otro DTE ordinario, y por eso están en un grupo aparte."
      }
    },
    {
      "id": "relacionados",
      "title": "Documentos relacionados",
      "body": [
        "Los documentos que corrigen o acompañan a otro piden elegirlo en el bloque Documento Relacionado. Solo aparecen documentos aceptados por Hacienda (estado Completada o Modificada): Nota de Crédito y Nota de Débito solo pueden relacionarse con un CCF; Nota de Remisión y Comp. Liquidación, con un CCF o una Factura.",
        "En la Nota de Crédito y la Nota de Débito elegir el CCF es obligatorio: sin él, Guardar DTE muestra «Selecciona el CCF que corrige esta Nota de Crédito (o Débito)». Para el resto de tipos con este bloque la selección es opcional.",
        "La forma más rápida es abrir el CCF completado y usar Más acciones, con Generar Nota de Crédito, Nota de Débito, Nota de Remisión o Comp. Liquidación: la app abre el formulario con el documento relacionado y las líneas ya copiadas. Estos documentos no cuentan en el límite mensual del plan gratuito."
      ],
      "figure": {
        "src": "/manual/img/fact-tipos-nc.webp",
        "alt": "Formulario de Nota de Crédito con el bloque Documento Relacionado y un CCF seleccionado",
        "caption": "Nota de Crédito: el CCF que corrige se elige en Documento Relacionado."
      }
    },
    {
      "id": "lineas",
      "title": "Líneas gravadas, exentas y no sujetas",
      "body": [
        "La categoría fiscal del producto (Gravado, Exento, No Gravado o Exportación, en el formulario de producto) decide en qué parte del documento cae cada línea. Gravado se vende con IVA de 13 %. Exento aparece en Ventas exentas y No Gravado en Ventas no sujetas; ambos se cobran sin IVA. En la línea aparece la nota «Exento de IVA — precio sin IVA» o «No sujeto de IVA — precio sin IVA».",
        "Hacienda separa estos montos en Factura, CCF, Nota de Crédito, Nota de Débito y Nota de Remisión; en Exportación, Sujeto Excluido y Donación no hay IVA y la categoría no cambia el resultado. Los precios de producto son con IVA incluido; el documento muestra la base sin IVA y el IVA de 13 % por separado.",
        "Los descuentos por línea y los botones de descuento rápido existen en Factura, CCF, Nota de Crédito, Nota de Débito y Nota de Remisión; los demás tipos los ignoran."
      ],
      "figure": {
        "src": "/manual/img/fact-tipos-lineas.webp",
        "alt": "Líneas de un CCF con un producto exento y uno no sujeto marcados debajo del nombre",
        "caption": "Líneas con producto exento y no sujeto."
      },
      "callout": {
        "kind": "warning",
        "title": "No todos los tipos aceptan líneas exentas",
        "body": "Comprobante de Retención, Comp. Liquidación, Doc. Contable y los eventos solo llevan ventas gravadas. Si agregas un producto exento o no sujeto, la línea se rechaza con el aviso «este tipo de documento solo admite ventas gravadas» y no podrás guardar hasta quitarla o cambiar el tipo."
      }
    },
    {
      "id": "retencion-percepcion",
      "title": "Retención y percepción de IVA",
      "body": [
        "El cuadro Totales muestra solo las líneas que aplican. En una Factura o un CCF aparece Retención IVA (1 %) cuando el cliente tiene marcado «Tiene retención de contribuyente» y la base sin IVA llega a 100 dólares o más; el Total a Pagar descuenta esa retención.",
        "Percepción IVA (1 %) solo aparece si la empresa está marcada como Agente de percepción de IVA en su configuración. Se suma en un CCF con base gravada de 100 dólares o más cuando el cliente no es gran contribuyente. Las Notas de Crédito y Débito llevan la percepción proporcional cuando el CCF relacionado la tuvo. Un texto bajo los totales explica si el documento la lleva o no."
      ],
      "figure": {
        "src": "/manual/img/fact-tipos-ccf.webp",
        "alt": "Formulario de CCF con el cuadro de totales mostrando ventas exentas, no sujetas, IVA y retención de IVA",
        "caption": "Totales de un CCF con ventas exentas, no sujetas y retención de IVA."
      }
    },
    {
      "id": "sujeto-excluido",
      "title": "Sujeto Excluido y retención de renta",
      "body": [
        "Al emitir una Factura de Sujeto Excluido (compra a quien no es contribuyente de IVA) el formulario incluye Retención de renta, con la casilla «Aplicar retención de renta (10%)» activada por defecto. La retención de 10 % corresponde a servicios; desactívala para compras de bienes. El total a pagar descuenta la retención."
      ],
      "figure": {
        "src": "/manual/img/fact-tipos-fse.webp",
        "alt": "Formulario de Sujeto Excluido con la casilla Aplicar retención de renta y el total a pagar reducido",
        "caption": "Sujeto Excluido con retención de renta de 10 %."
      }
    }
  ],
  "walkthrough": {
    "id": "fact-dte-tipos-walkthrough",
    "title": "Elegir el tipo y entender los totales",
    "image": "/manual/img/fact-dte-tipo.webp",
    "aspect": 1.778,
    "steps": [
      {
        "at": 0.5,
        "dur": 4,
        "caption": "Cada tarjeta es un tipo de documento; el tipo decide qué datos pide el formulario.",
        "highlight": {
          "x": 18.9,
          "y": 17.4,
          "w": 79.8,
          "h": 58.1
        }
      },
      {
        "at": 4.5,
        "dur": 4,
        "caption": "La Nota de Crédito exige elegir el CCF que corrige.",
        "image": "/manual/img/fact-tipos-nc.webp",
        "highlight": {
          "x": 18.9,
          "y": 17.4,
          "w": 52.9,
          "h": 81.6
        },
        "cursor": {
          "x": 45.3,
          "y": 58.2,
          "click": true
        }
      },
      {
        "at": 8.5,
        "dur": 4,
        "caption": "Los productos exentos y no sujetos se muestran marcados en cada línea.",
        "image": "/manual/img/fact-tipos-lineas.webp",
        "highlight": {
          "x": 18.9,
          "y": 36.3,
          "w": 52.9,
          "h": 62.6
        }
      },
      {
        "at": 12.5,
        "dur": 4,
        "caption": "Los totales separan lo gravado, exento y no sujeto, e incluyen la retención de IVA.",
        "image": "/manual/img/fact-tipos-ccf.webp",
        "highlight": {
          "x": 72.7,
          "y": 17.4,
          "w": 26,
          "h": 38.4
        }
      },
      {
        "at": 16.5,
        "dur": 4,
        "caption": "En Sujeto Excluido puedes aplicar o no la retención de renta de 10 %.",
        "image": "/manual/img/fact-tipos-fse.webp",
        "highlight": {
          "x": 20.4,
          "y": 46.7,
          "w": 49.8,
          "h": 6.3
        },
        "cursor": {
          "x": 45.3,
          "y": 49.9,
          "click": true
        }
      },
      {
        "at": 20.5,
        "dur": 3,
        "caption": "El total a pagar ya descuenta la retención.",
        "highlight": {
          "x": 72.7,
          "y": 17.4,
          "w": 26,
          "h": 27.5
        }
      }
    ]
  }
};

export default chapter;
