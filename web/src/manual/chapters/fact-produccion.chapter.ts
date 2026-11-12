import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "fact-produccion",
  "order": 201,
  "group": "Facturación electrónica",
  "title": "Solicitar acceso a producción",
  "summary": "Homologa tu empresa enviando a Hacienda un lote de documentos de prueba para obtener la empresa de producción.",
  "sections": [
    {
      "id": "que-hace",
      "title": "Qué hace este proceso",
      "body": [
        "Una empresa nueva trabaja en ambiente Desarrollo: sus documentos son de prueba y no tienen validez fiscal. Para emitir documentos reales, Hacienda exige una homologación: enviar documentos de prueba de cada tipo. La pantalla Solicitar acceso a producción automatiza ese envío.",
        "Se abre desde el detalle de la empresa, con el botón Iniciar proceso de la tarjeta «Solicita acceso a producción». Solo está disponible para empresas en Desarrollo; si la empresa ya está en producción, la pantalla lo indica y no hace falta repetir el proceso."
      ],
      "figure": {
        "src": "/manual/img/fact-empresas-detalle.webp",
        "alt": "Detalle de empresa con la tarjeta Solicita acceso a producción y el botón Iniciar proceso",
        "caption": "La tarjeta con el botón Iniciar proceso está en el detalle de la empresa."
      }
    },
    {
      "id": "verificacion",
      "title": "Verificación previa",
      "body": [
        "Antes de enviar nada, la app comprueba tres cosas y muestra el resultado de cada una: el Certificado de firma (intenta firmar una prueba), la Contraseña del certificado (guardada en el llavero) y las Credenciales de Hacienda (las valida contra la API de pruebas).",
        "Cada fila indica su estado: Verificado, Guardada o Verificadas cuando todo está bien; Falta, Inválido o Sin conexión cuando hay un problema, con el motivo debajo. La etiqueta de la tarjeta cambia de Incompleto a Listo. Ir a configuración te lleva a la empresa para corregirlo y Verificar repite la comprobación."
      ],
      "figure": {
        "src": "/manual/img/fact-produccion-requisitos.webp",
        "alt": "Pantalla Solicitar acceso a producción con la verificación previa en estado Listo",
        "caption": "Verificación previa: certificado, contraseña y credenciales."
      }
    },
    {
      "id": "lote-y-tipos",
      "title": "Tamaño del lote y tipos de DTE",
      "body": [
        "Cada vez que inicias el proceso se genera un lote nuevo, del tamaño que elijas con los botones «N por tipo», para cada tipo seleccionado, y se envía a Hacienda como prueba de implementación. La lista incluye los 11 tipos de DTE y los eventos de Contingencia (5 solicitudes) y de Invalidación (5): estos dos procesan siempre 5 documentos, requisito de Hacienda."
      ],
      "steps": [
        "Revisa que la verificación previa esté en Listo.",
        "Elige el tamaño del lote con los botones «N por tipo».",
        "Marca los tipos que quieras procesar; Seleccionar todos y Limpiar ayudan a cambiar la selección rápido.",
        "Pulsa Iniciar proceso completo (o Procesar seleccionados, con el número de tipos entre paréntesis).",
        "Sigue la barra de cada tipo y la barra Envío general. Si algún lote falla, abre el resumen y usa Reintentar lotes con errores, o Reenviar pendientes para los documentos de esta sesión que Hacienda aún no aceptó."
      ],
      "figure": {
        "src": "/manual/img/fact-produccion-tipos.webp",
        "alt": "Lista de tipos de DTE con casillas, estado Pendiente y barra de avance por cada tipo",
        "caption": "Los tipos de DTE y eventos que se envían como prueba."
      },
      "callout": {
        "kind": "warning",
        "title": "Envía documentos de prueba reales",
        "body": "El proceso transmite documentos de prueba al ambiente de pruebas de Hacienda: necesitas conexión a internet y credenciales válidas. Cada ejecución genera lotes nuevos, no reutiliza documentos anteriores."
      }
    },
    {
      "id": "al-terminar",
      "title": "Al terminar la homologación",
      "body": [
        "La homologación solo se completa cuando todos los lotes seleccionados fueron aceptados por Hacienda. En ese momento la app crea automáticamente una nueva empresa en modo producción con el mismo NIT, NRC, dirección y actividad, sin certificado, sin credenciales y sin historial; la empresa de pruebas queda intacta.",
        "La empresa de producción todavía no puede emitir DTE. Descarga el certificado de producción y crea las credenciales API de producción en el portal de Hacienda (la pantalla trae el enlace Ir al portal de Hacienda), y cárgalos en Editar configuración de la nueva empresa. Mientras no lo hagas, la configuración de esa empresa avisa que firma con el certificado y la contraseña de pruebas."
      ],
      "callout": {
        "kind": "info",
        "title": "Dos empresas, un mismo NIT",
        "body": "Después de la homologación verás dos empresas con el mismo NIT: la de Desarrollo y la de Producción. Usa Trabajar con esta empresa en el detalle para elegir con cuál emites."
      }
    }
  ],
  "walkthrough": {
    "id": "fact-produccion-walkthrough",
    "title": "Solicitar acceso a producción",
    "image": "/manual/img/fact-empresas-detalle.webp",
    "aspect": 1.778,
    "steps": [
      {
        "at": 0.5,
        "dur": 3,
        "caption": "En el detalle de una empresa de Desarrollo, pulsa Iniciar proceso.",
        "highlight": {
          "x": 85,
          "y": 24.1,
          "w": 12.1,
          "h": 6.5
        },
        "cursor": {
          "x": 91.1,
          "y": 27.4,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 4,
        "caption": "La verificación previa comprueba certificado, contraseña y credenciales.",
        "image": "/manual/img/fact-produccion-requisitos.webp",
        "highlight": {
          "x": 30.2,
          "y": 49.5,
          "w": 57.1,
          "h": 33.6
        }
      },
      {
        "at": 7.5,
        "dur": 3,
        "caption": "Si cambiaste algo en la configuración, vuelve a verificar.",
        "highlight": {
          "x": 77.5,
          "y": 52.2,
          "w": 8.3,
          "h": 6
        },
        "cursor": {
          "x": 81.7,
          "y": 55.2,
          "click": true
        }
      },
      {
        "at": 10.5,
        "dur": 4,
        "caption": "Elige los tipos de DTE y eventos que enviarás como prueba.",
        "image": "/manual/img/fact-produccion-tipos.webp",
        "highlight": {
          "x": 73.6,
          "y": 7,
          "w": 8.3,
          "h": 3.6
        },
        "cursor": {
          "x": 77.8,
          "y": 8.8,
          "click": true
        }
      },
      {
        "at": 14.5,
        "dur": 4,
        "caption": "Cada tipo muestra su barra de avance mientras Hacienda recibe los documentos.",
        "highlight": {
          "x": 30.2,
          "y": 0,
          "w": 57.1,
          "h": 100
        }
      }
    ]
  }
};

export default chapter;
