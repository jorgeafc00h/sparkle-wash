import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "fact-empresas",
  "order": 200,
  "group": "Facturación electrónica",
  "title": "Empresas: NIT, certificado y credenciales de Hacienda",
  "summary": "Registra la empresa que emite los DTE, carga su certificado de firma y guarda las credenciales de la API del Ministerio de Hacienda.",
  "sections": [
    {
      "id": "que-es-una-empresa",
      "title": "Qué es una empresa en Car Spa",
      "body": [
        "Todo documento tributario electrónico (DTE) se emite a nombre de una empresa: su razón social, NIT, NRC, actividad económica, dirección y los datos con los que se firma. Las pantallas de Facturas, Clientes, Productos y Compras trabajan siempre con la empresa activa.",
        "Abre Empresas desde la barra lateral. La tabla muestra el nombre comercial, el NIT, el ambiente (Desarrollo o Producción), si la empresa tiene certificado válido y cuál es la predeterminada (la estrella). La fila marcada como Activa es donde se crean los DTE y los tickets nuevos."
      ],
      "figure": {
        "src": "/manual/img/fact-empresas-lista.webp",
        "alt": "Lista de empresas con el botón Nueva Empresa y la etiqueta Activa en la empresa de trabajo",
        "caption": "Lista de empresas: el botón Nueva Empresa y la etiqueta Activa."
      },
      "callout": {
        "kind": "info",
        "title": "Límite de empresas por plan",
        "body": "El botón Nueva Empresa se desactiva cuando llegas al máximo de tu plan: Free permite 1 empresa, Pro hasta 2 y Business o superior sin límite. Debajo del encabezado aparece un aviso con el botón Ver planes."
      }
    },
    {
      "id": "crear-una-empresa",
      "title": "Crear una empresa",
      "body": [
        "El asistente tiene cuatro pasos y puedes volver atrás con Anterior sin perder lo escrito. La empresa nueva siempre nace en ambiente Desarrollo."
      ],
      "steps": [
        "En Empresas pulsa Nueva Empresa.",
        "Paso 1, Información Básica: escribe el Nombre Legal y el Nombre Comercial (obligatorios), el NIT con el formato 0000-000000-000-0 y el NRC con el formato 000000-0.",
        "Paso 2, Contacto y Ubicación: correo electrónico, teléfono, dirección (complemento) y los desplegables de departamento, municipio y distrito.",
        "Paso 3, Actividad Económica: elige la actividad del catálogo de Hacienda y el tipo de establecimiento.",
        "Paso 4, Certificado: opcionalmente adjunta el archivo .crt XML de Hacienda y escribe su contraseña. Puedes dejarlo para después en la configuración de la empresa.",
        "Al finalizar, la app crea la empresa y abre su detalle con el aviso «Empresa creada correctamente»."
      ],
      "figure": {
        "src": "/manual/img/fact-empresas-nueva.webp",
        "alt": "Paso 1 del asistente Nueva Empresa con nombre legal, nombre comercial, NIT y NRC",
        "caption": "Paso 1 del asistente: nombre, NIT y NRC (datos ficticios)."
      },
      "callout": {
        "kind": "info",
        "title": "Establecimiento y punto de venta",
        "body": "Al crear la empresa la app asigna el código de establecimiento M001 y el de punto de venta P001. Aparecen en el número de control de cada documento (por ejemplo DTE-01-M001P001-000000000000001). La pantalla no ofrece campos para cambiarlos."
      }
    },
    {
      "id": "detalle",
      "title": "El detalle de la empresa",
      "body": [
        "Al tocar una fila de la lista se abre el detalle: información general, ambiente, estado del certificado digital, credenciales API y logo. Cada tarjeta tiene un lápiz que lleva a la parte correspondiente de la configuración.",
        "Aquí decides con qué empresa trabajas. Si la empresa no es la activa verás el botón Trabajar con esta empresa; si lo es, aparece la etiqueta Empresa activa. Predeterminar mueve la estrella y también la deja activa. Si la empresa está en Desarrollo, una tarjeta ofrece Iniciar proceso para solicitar acceso a producción.",
        "Eliminar una empresa solo se permite cuando todas sus facturas están en estado Nueva; los documentos ya emitidos, anulados o con error deben conservarse."
      ],
      "figure": {
        "src": "/manual/img/fact-empresas-detalle.webp",
        "alt": "Detalle de empresa con la etiqueta Empresa activa y la tarjeta para solicitar acceso a producción",
        "caption": "Detalle de la empresa."
      }
    },
    {
      "id": "configuracion",
      "title": "Configuración: datos, ambiente y certificado",
      "body": [
        "Desde el lápiz del detalle se abre Configuración de Empresa. Cada tarjeta guarda por separado.",
        "Información General: razón social, nombre comercial, NIT (formato NNNN-NNNNNN-NNN-N), NRC, correo y teléfono. Pulsa Guardar para aplicar.",
        "Ambiente: la etiqueta indica Desarrollo (documentos de prueba sin validez fiscal) o Producción (documentos enviados al Ministerio de Hacienda real). Promover a Producción crea una empresa nueva de producción con el mismo NIT y datos, sin certificado, sin credenciales API y sin facturas, clientes ni compras; la empresa de desarrollo queda intacta para seguir probando."
      ],
      "figure": {
        "src": "/manual/img/fact-empresas-config-datos.webp",
        "alt": "Configuración de empresa con la tarjeta Información General y la tarjeta Ambiente",
        "caption": "Información General y Ambiente."
      }
    },
    {
      "id": "certificado",
      "title": "Certificado de firma",
      "body": [
        "Para firmar los DTE necesitas el certificado que emite Hacienda (un archivo .crt en formato XML) y su contraseña privada. La tarjeta Certificado de Firma lo guía en tres pasos, y la etiqueta de la esquina muestra el estado: Sin configurar, Falta archivo, Pendiente de validar o Válido."
      ],
      "steps": [
        "Paso 1, Contraseña: escribe la contraseña del certificado, repítela en Confirmar Contraseña y pulsa guardar. Se conserva en el llavero del sistema operativo; con Cambiar contraseña la reemplazas.",
        "Paso 2, Archivo .crt de Hacienda (XML): elige el archivo y guárdalo. La app comprueba que el NIT del certificado coincida con el de la empresa.",
        "Paso 3, Validar: pulsa Validar Certificado. Verifica que la contraseña y el archivo coinciden; es la única acción que deja el estado en Válido. Al validar se muestran los detalles: NIT propietario, si está activo y la huella de la clave pública.",
        "Eliminar Certificado borra el archivo, la contraseña y la caché de firma; tendrás que configurarlos de nuevo para enviar DTE."
      ],
      "figure": {
        "src": "/manual/img/fact-empresas-config-cert.webp",
        "alt": "Tarjeta Certificado de Firma con los pasos Contraseña, Archivo .crt y Validar",
        "caption": "Los tres pasos del certificado de firma."
      },
      "callout": {
        "kind": "warning",
        "title": "Producción usa su propio certificado",
        "body": "Hacienda entrega un certificado de producción distinto al de pruebas. Una empresa de producción que aún no cargó el suyo firma con el de pruebas y la pantalla lo avisa; guarda el de producción antes de emitir documentos reales."
      }
    },
    {
      "id": "credenciales",
      "title": "Credenciales API y numeración",
      "body": [
        "La tarjeta Credenciales API guarda el usuario (el NIT de la empresa) y la contraseña de la API de Hacienda. Se almacenan cifradas en el llavero del sistema.",
        "Validar y guardar comprueba primero la contraseña con Hacienda, en el ambiente de la propia empresa (pruebas o producción), y solo la guarda si Hacienda la acepta. Probar credenciales guardadas verifica la copia que ya está en el llavero. Debajo de los botones, una línea de estado explica en texto lo último que pasó (guardada, rechazada o sin conexión). Eliminar pide confirmación y, sin credenciales, no podrás enviar DTE.",
        "Más abajo, Configuración de Facturas permite ajustar el porcentaje de IVA (13 por defecto), el prefijo y el número actual de factura, activar los números de control secuenciales (requiere usar un solo dispositivo, para evitar colisiones) y marcar la empresa como Agente de percepción de IVA (1%), solo si Hacienda te designó como tal."
      ],
      "figure": {
        "src": "/manual/img/fact-empresas-config-cred.webp",
        "alt": "Tarjeta Credenciales API con los botones Validar y actualizar, Probar credenciales guardadas y Eliminar",
        "caption": "Credenciales API y configuración de facturas."
      }
    }
  ],
  "walkthrough": {
    "id": "fact-empresas-walkthrough",
    "title": "Registrar una empresa y dejarla lista para firmar",
    "image": "/manual/img/fact-empresas-lista.webp",
    "aspect": 1.778,
    "steps": [
      {
        "at": 0.5,
        "dur": 3,
        "caption": "En Empresas, pulsa Nueva Empresa para abrir el asistente.",
        "highlight": {
          "x": 86,
          "y": 2.3,
          "w": 12.6,
          "h": 6.5
        },
        "cursor": {
          "x": 92.3,
          "y": 5.6,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 4,
        "caption": "Paso 1: escribe el nombre, el NIT y el NRC de la empresa.",
        "image": "/manual/img/fact-empresas-nueva.webp",
        "highlight": {
          "x": 35.3,
          "y": 56.6,
          "w": 23.4,
          "h": 6.5
        },
        "cursor": {
          "x": 47,
          "y": 59.9
        },
        "type": {
          "x": 47,
          "y": 59.9,
          "text": "0614-111111-111-1"
        }
      },
      {
        "at": 7.5,
        "dur": 3,
        "caption": "Pulsa Siguiente para pasar a contacto, actividad y certificado.",
        "highlight": {
          "x": 73.9,
          "y": 67.4,
          "w": 10,
          "h": 6.5
        },
        "cursor": {
          "x": 78.9,
          "y": 70.7,
          "click": true
        }
      },
      {
        "at": 10.5,
        "dur": 3,
        "caption": "En el detalle de la empresa confirma que es la activa.",
        "image": "/manual/img/fact-empresas-detalle.webp",
        "highlight": {
          "x": 63.7,
          "y": 7.7,
          "w": 10.5,
          "h": 6.5
        }
      },
      {
        "at": 13.5,
        "dur": 4,
        "caption": "En Configuración, el certificado se guarda y se valida en tres pasos.",
        "image": "/manual/img/fact-empresas-config-cert.webp",
        "highlight": {
          "x": 33.7,
          "y": 9.6,
          "w": 50.1,
          "h": 72.8
        },
        "zoom": {
          "x": 33.7,
          "y": 9.6,
          "w": 50.1,
          "h": 72.8
        }
      },
      {
        "at": 17.5,
        "dur": 3,
        "caption": "Pulsa Validar Certificado: solo así queda en estado Válido.",
        "highlight": {
          "x": 38.9,
          "y": 63.8,
          "w": 11.7,
          "h": 6
        },
        "cursor": {
          "x": 44.8,
          "y": 66.8,
          "click": true
        },
        "toast": "Certificado válido: contraseña y archivo coinciden"
      },
      {
        "at": 20.5,
        "dur": 4,
        "caption": "Guarda las credenciales de Hacienda: primero se validan contra la API.",
        "image": "/manual/img/fact-empresas-config-cred.webp",
        "highlight": {
          "x": 35.3,
          "y": 38.3,
          "w": 12.5,
          "h": 6.5
        },
        "cursor": {
          "x": 41.6,
          "y": 41.6,
          "click": true
        }
      }
    ]
  }
};

export default chapter;
