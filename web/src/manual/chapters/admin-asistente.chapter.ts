import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "admin-asistente",
  "order": 406,
  "group": "Administración",
  "title": "Asistente y soporte",
  "summary": "Pregunta al asistente con inteligencia artificial y, si algo falla, envía un ticket de soporte con los registros de la app.",
  "sections": [
    {
      "id": "chat",
      "title": "El asistente (Chat Soporte)",
      "body": [
        "Chat Soporte (ruta /chat) es un asistente con inteligencia artificial que responde en un servidor externo; necesita conexión a internet. Escribe tu consulta o toca una sugerencia («¿Cómo anulo una factura?», «Explícame los tipos de DTE»…) y pulsa Enter o el botón de enviar.",
        "La app solo envía tu mensaje y datos de contexto: tu identificador, y el NIT y nombre de la empresa y tu correo cuando existen. Lo que el asistente sabe responder depende del servidor; la pantalla advierte que las respuestas son generadas por IA, pueden contener errores y conviene verificar la información importante.",
        "Si el servidor no responde, la pantalla muestra «No se puede conectar con el asistente en este momento…» y el campo queda desactivado."
      ],
      "figure": {
        "src": "/manual/img/admin-chat-conversacion.webp",
        "alt": "Chat Soporte con una pregunta del usuario y una respuesta",
        "caption": "Conversación. La respuesta de la captura es texto de ejemplo, no una respuesta real del asistente."
      },
      "callout": {
        "kind": "info",
        "title": "No es un canal de soporte humano",
        "body": "El chat no crea tickets. Para que alguien del equipo revise un problema, usa «Crear ticket de soporte» (más abajo)."
      }
    },
    {
      "id": "sin-conexion",
      "title": "Cuando no hay conexión",
      "body": [
        "Sin internet, o si el servicio del asistente está caído, aparece el aviso rojo y puedes seguir trabajando con el resto de la app."
      ],
      "figure": {
        "src": "/manual/img/admin-chat-sin-conexion.webp",
        "alt": "Chat Soporte con el aviso de que no se puede conectar con el asistente",
        "caption": "Aviso cuando el asistente no está disponible."
      }
    },
    {
      "id": "registros",
      "title": "Registros del sistema",
      "body": [
        "En Configuración, la tarjeta «Registros del Sistema» guarda un registro de actividad local para diagnóstico; la propia pantalla indica que no contiene contraseñas ni información sensible."
      ],
      "steps": [
        "«Exportar a archivo» guarda los registros en un archivo que tú eliges.",
        "«Enviar al servidor» los sube para diagnóstico y muestra «Registros enviados al servidor para diagnóstico».",
        "«Crear ticket de soporte» abre el formulario del siguiente apartado."
      ],
      "figure": {
        "src": "/manual/img/admin-ajustes-logs.webp",
        "alt": "Tarjeta Registros del Sistema con Exportar a archivo, Enviar al servidor y Crear ticket de soporte",
        "caption": "Opciones de diagnóstico en Configuración."
      }
    },
    {
      "id": "ticket",
      "title": "Crear un ticket de soporte",
      "body": [
        "El ticket envía los registros locales de esta instalación y un enlace a los eventos de Application Insights de ese momento, para que soporte vea el error."
      ],
      "steps": [
        "Elige la Categoría: Impresión de tickets, Sincronización, Plataforma / app, Cuenta u Otro.",
        "Escribe el Resumen del problema (obligatorio, hasta 200 caracteres) y, si quieres, el Detalle: qué hiciste, qué esperabas y qué pasó.",
        "Pulsa «Enviar a soporte».",
        "Se muestra el número del ticket y el enlace «Ver eventos en Application Insights». Anota el número para dar seguimiento."
      ],
      "figure": {
        "src": "/manual/img/admin-soporte-form.webp",
        "alt": "Ventana Crear ticket de soporte con categoría, resumen y detalle",
        "caption": "Formulario del ticket (texto de ejemplo)."
      },
      "callout": {
        "kind": "warning",
        "title": "El número de la captura es simulado",
        "body": "El ticket «SUP-DEMO-0001» de las capturas viene de un servidor de prueba simulado; en la app real el número lo asigna el servicio de soporte. El ticket además adjunta el NIT y el nombre de la empresa activa."
      }
    }
  ],
  "walkthrough": {
    "id": "admin-asistente",
    "title": "Preguntar y pedir soporte",
    "image": "/manual/img/admin-chat-vacio.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3.5,
        "caption": "Escribe tu consulta en el chat o toca una sugerencia.",
        "highlight": {
          "x": 20.1,
          "y": 76.4,
          "w": 73.1,
          "h": 7
        },
        "cursor": {
          "x": 56.7,
          "y": 79.9,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 3.5,
        "caption": "El asistente responde; verifica lo importante.",
        "image": "/manual/img/admin-chat-conversacion.webp",
        "highlight": {
          "x": 18.9,
          "y": 2.3,
          "w": 79.8,
          "h": 85.9
        },
        "cursor": {
          "x": 58.8,
          "y": 45.3
        }
      },
      {
        "at": 7,
        "dur": 3.5,
        "caption": "Sin conexión, el chat avisa y se desactiva.",
        "image": "/manual/img/admin-chat-sin-conexion.webp",
        "highlight": {
          "x": 18.9,
          "y": 12.8,
          "w": 79.8,
          "h": 7
        },
        "cursor": {
          "x": 58.8,
          "y": 16.3
        }
      },
      {
        "at": 10.5,
        "dur": 3.5,
        "caption": "En Configuración, abre Crear ticket de soporte.",
        "image": "/manual/img/admin-ajustes-logs.webp",
        "highlight": {
          "x": 45,
          "y": 71,
          "w": 15,
          "h": 6
        },
        "cursor": {
          "x": 52.5,
          "y": 74,
          "click": true
        }
      },
      {
        "at": 14,
        "dur": 4,
        "caption": "Describe el problema con tus palabras.",
        "image": "/manual/img/admin-soporte-form.webp",
        "highlight": {
          "x": 32.6,
          "y": 50.3,
          "w": 34.8,
          "h": 6.5
        },
        "cursor": {
          "x": 50,
          "y": 53.6
        },
        "type": {
          "x": 33.8,
          "y": 53.6,
          "text": "La impresora de tickets no imprime al cobrar"
        }
      },
      {
        "at": 18,
        "dur": 3.5,
        "caption": "Envía a soporte y anota el número del ticket.",
        "image": "/manual/img/admin-soporte-creado.webp",
        "highlight": {
          "x": 35.6,
          "y": 45.6,
          "w": 8.9,
          "h": 3.9
        },
        "cursor": {
          "x": 40.1,
          "y": 47.6
        },
        "toast": "Ticket creado"
      }
    ]
  }
};

export default chapter;
