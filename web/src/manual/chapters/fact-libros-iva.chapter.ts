import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "fact-libros-iva",
  "order": 206,
  "group": "Facturación electrónica",
  "title": "Exportar documentos y Libros de IVA",
  "summary": "Descarga tus DTE en Excel, JSON o PDF y genera los anexos F-07 de los libros de IVA de un mes para el Ministerio de Hacienda.",
  "sections": [
    {
      "id": "libros",
      "title": "Libros de IVA (anexos F-07)",
      "body": [
        "Libros IVA, en la barra lateral, genera los archivos del mes que se presentan a Hacienda. Elige el Mes y el Año (los últimos tres años) en la tarjeta Período. La tarjeta Resumen cuenta los DTE declarables de ese mes por tipo, con las columnas Total, Completados y Anulados.",
        "La tarjeta Archivos a generar lista lo que se descarga: Anexo 1, Ventas a Contribuyentes (CCF, NC, ND); Anexo 2, Ventas Consumidor Final; Anexo 3, Compras con crédito fiscal (CCF, NC, ND); Anexo 5, Compras a Sujetos Excluidos (FSE); y el archivo de Anulados. Salen como archivos CSV en UTF-8 con BOM, separados por punto y coma y sin encabezados. Las compras salen de la pantalla Compras de la misma empresa."
      ],
      "steps": [
        "Abre Libros IVA y elige el Mes y el Año.",
        "Revisa el Resumen: solo cuentan los documentos del período de la empresa activa.",
        "Pulsa Descargar Libros IVA. La app descarga un CSV por anexo y confirma cuántos archivos generó.",
        "Para guardarlos en la nube, pulsa Enviar a Google Drive (requiere haber conectado tu cuenta de Google en Configuración)."
      ],
      "figure": {
        "src": "/manual/img/fact-libros-iva.webp",
        "alt": "Pantalla Libros de IVA con el período, el resumen por tipo de DTE y los archivos a generar",
        "caption": "Libros de IVA: período, resumen y archivos del mes."
      },
      "callout": {
        "kind": "warning",
        "title": "Requiere plan Pro o Business",
        "body": "En el plan Free la pantalla muestra «Disponible con Pro o Business» y no permite descargar. Si hay tickets del punto de venta del período sin consolidar en un DTE, un aviso lo indica con el botón Consolidar: esas ventas no aparecen en el libro hasta consolidarlas."
      }
    },
    {
      "id": "exportar",
      "title": "Exportar DTE y eventos",
      "body": [
        "La pantalla Exportar DTE y Eventos descarga la lista de documentos de la empresa activa. En Filtros elige Desde y Hasta (por defecto, del primer día del mes a hoy), el Tipo de documento y el Estado (Nueva, Completada, Anulada o Error envío). La tarjeta Resumen muestra cuántos documentos cumplen y su total.",
        "En Formato elige Excel (.xlsx), disponible en todos los planes, JSON (plan de pago) o PDF individual (plan de pago, un archivo por documento). Descargar (N) genera el archivo y Enviar a Google Drive lo sube a tu cuenta de Google, también como función de plan de pago. Si no hay documentos con esos filtros, la app avisa «No hay DTE o eventos que cumplan los filtros seleccionados»."
      ],
      "figure": {
        "src": "/manual/img/fact-libros-exportar.webp",
        "alt": "Pantalla Exportar DTE y Eventos con filtros de fecha, tipo y estado, formato y botón Descargar",
        "caption": "Exportar DTE y eventos: filtros, resumen y formato."
      },
      "callout": {
        "kind": "info",
        "title": "Dónde está esta pantalla",
        "body": "En esta versión de la app, Exportar DTE y Eventos está registrada con la ruta #/invoices/export pero ningún botón de los menús la abre; el permiso de exportación sí existe en Usuarios y permisos. Los libros de IVA, en cambio, tienen su propia entrada en la barra lateral."
      }
    }
  ],
  "walkthrough": {
    "id": "fact-libros-iva-walkthrough",
    "title": "Generar los libros de IVA de un mes",
    "image": "/manual/img/fact-libros-iva.webp",
    "aspect": 1.778,
    "steps": [
      {
        "at": 0.5,
        "dur": 3,
        "caption": "Elige el mes y el año del libro que vas a presentar.",
        "highlight": {
          "x": 18.9,
          "y": 12.8,
          "w": 52.9,
          "h": 69.5
        },
        "cursor": {
          "x": 45.3,
          "y": 47.6,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 4,
        "caption": "El resumen cuenta los documentos del mes por tipo: totales, completados y anulados.",
        "highlight": {
          "x": 18.9,
          "y": 12.8,
          "w": 52.9,
          "h": 69.5
        }
      },
      {
        "at": 7.5,
        "dur": 4,
        "caption": "Estos son los anexos F-07 que se generan en archivos CSV.",
        "highlight": {
          "x": 72.7,
          "y": 12.8,
          "w": 26,
          "h": 69.5
        }
      },
      {
        "at": 11.5,
        "dur": 3,
        "caption": "Pulsa Descargar Libros IVA.",
        "highlight": {
          "x": 72.7,
          "y": 55.7,
          "w": 26,
          "h": 7.6
        },
        "cursor": {
          "x": 85.7,
          "y": 59.5,
          "click": true
        }
      },
      {
        "at": 14.5,
        "dur": 4,
        "caption": "Para otros formatos, Exportar DTE permite filtrar por fecha, tipo y estado.",
        "image": "/manual/img/fact-libros-exportar.webp",
        "highlight": {
          "x": 18.9,
          "y": 12.8,
          "w": 52.9,
          "h": 30.5
        }
      },
      {
        "at": 18.5,
        "dur": 3,
        "caption": "Elige Excel, JSON o PDF y descarga.",
        "highlight": {
          "x": 72.7,
          "y": 37.5,
          "w": 26,
          "h": 16.7
        },
        "cursor": {
          "x": 85.7,
          "y": 45.9,
          "click": true
        }
      }
    ]
  }
};

export default chapter;
