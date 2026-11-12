import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "admin-usuarios",
  "order": 403,
  "group": "Administración",
  "title": "Usuarios locales, PIN y auditoría",
  "summary": "Crea usuarios con PIN para quienes comparten la computadora, limita lo que ve cada uno y revisa quién hizo qué.",
  "sections": [
    {
      "id": "activar",
      "title": "Activar el control de usuarios",
      "body": [
        "Configuración → Usuarios y permisos (ruta /settings/users) es solo para el administrador. Sirve para las personas que comparten la computadora: cajeros, facturación, contador. Cada una entra con su PIN, ve solo las pantallas que le asignes y la app registra quién creó o modificó cada factura, cliente, producto, venta y compra.",
        "Tu cuenta de Google es el administrador, y por eso debes haber iniciado sesión antes de activar. Los usuarios y el historial se guardan solo en esta computadora: no se envían a Hacienda ni a la nube."
      ],
      "steps": [
        "Pulsa «Activar con esta cuenta».",
        "Elige el PIN del administrador (de 4 a 8 dígitos) y confírmalo.",
        "Pulsa «Activar control de usuarios». Si olvidas el PIN podrás entrar con tu cuenta de Google."
      ],
      "figure": {
        "src": "/manual/img/admin-usuarios-pin.webp",
        "alt": "Ventana PIN del administrador con nuevo PIN y confirmación",
        "caption": "Elegir el PIN del administrador."
      }
    },
    {
      "id": "crear",
      "title": "Crear usuarios y asignar pantallas",
      "body": [
        "Con el control activo, la lista muestra la cuenta administradora y los usuarios. Pulsa «Nuevo usuario»."
      ],
      "steps": [
        "Escribe el Nombre y el Usuario (letras, números, punto o guion, de 2 a 32; se muestra en la pantalla de acceso). Elige el PIN y confírmalo.",
        "Elige un preajuste: Cajero, Facturación, Contador, Todas o Ninguna. Luego marca o desmarca pantallas por grupo (Principal, Punto de venta, Documentos y finanzas, Sistema).",
        "Hay permisos de acción separados de abrir pantallas: Anular tickets, Devoluciones y Entradas/salidas de efectivo.",
        "Pulsa «Crear usuario». Debes dejar al menos una pantalla marcada."
      ],
      "figure": {
        "src": "/manual/img/admin-usuario-form.webp",
        "alt": "Formulario Nuevo usuario con nombre, usuario, PIN y pantallas permitidas con el preajuste Cajero",
        "caption": "Un cajero con las pantallas del preajuste Cajero."
      },
      "callout": {
        "kind": "info",
        "title": "Lo que nunca se concede",
        "body": "Usuarios y permisos y el Historial de actividad son exclusivos del administrador; no se pueden asignar."
      }
    },
    {
      "id": "gestionar",
      "title": "Administrar usuarios",
      "body": [
        "En cada fila hay iconos para Editar, Restablecer PIN (en tu propia fila, «Cambiar mi PIN»), Desactivar o Reactivar (un usuario desactivado ya no puede entrar) y Eliminar. «Desactivar control» apaga todo el sistema de usuarios."
      ],
      "figure": {
        "src": "/manual/img/admin-usuarios-lista.webp",
        "alt": "Lista de usuarios con la cuenta administradora y dos usuarios activos",
        "caption": "Administrador y dos usuarios."
      }
    },
    {
      "id": "bloqueo",
      "title": "La pantalla de acceso y el cambio de usuario",
      "body": [
        "Con el control activo, al abrir la app aparece «¿Quién está usando la app?». Elige tu tarjeta, escribe el PIN y pulsa Entrar. «Cambiar de usuario» regresa a la lista.",
        "Tras 5 intentos fallidos se bloquea el acceso 30 segundos. El administrador puede usar «¿Olvidaste el PIN? Entrar con tu cuenta de Google».",
        "Para cambiar de persona sin cerrar la app, usa el botón de salida junto a tu nombre al pie del menú lateral."
      ],
      "figure": {
        "src": "/manual/img/admin-bloqueo-error.webp",
        "alt": "Pantalla de acceso con PIN incorrecto 1 de 5",
        "caption": "PIN incorrecto: la app cuenta los intentos."
      }
    },
    {
      "id": "restringido",
      "title": "Qué ve un usuario con permisos limitados",
      "body": [
        "Las pantallas sin permiso aparecen en el menú con un candado y no se pueden abrir; si alguien escribe la dirección de una pantalla restringida ve «Acceso restringido». Los botones de acciones sin permiso aparecen bloqueados con la razón. El nombre del cajero queda en cada ticket."
      ],
      "figure": {
        "src": "/manual/img/admin-sidebar-cajero.webp",
        "alt": "Venta de un cajero con las demás pantallas del menú bloqueadas",
        "caption": "Un cajero solo ve lo que el administrador le asignó."
      }
    },
    {
      "id": "auditoria",
      "title": "Historial de actividad",
      "body": [
        "El botón «Historial de actividad» (ruta /settings/audit) muestra quién creó y modificó cada registro en esta computadora: los últimos 3,000 eventos. Cada fila trae la fecha, el usuario, el tipo de registro (Usuario, Ticket…) y la acción: «Activó el control de usuarios», «Creó el usuario…», «Inició sesión», «Cerró sesión», «Intento de acceso con PIN incorrecto» y «Registró la venta ticket #1 por $18.50».",
        "Filtra con Buscar, Usuario, Tipo de registro y Empresa (empresa actual o todas)."
      ],
      "figure": {
        "src": "/manual/img/admin-auditoria.webp",
        "alt": "Historial de actividad con eventos de inicio de sesión, creación de usuarios y ventas",
        "caption": "Eventos de ejemplo de un día de trabajo."
      }
    }
  ],
  "walkthrough": {
    "id": "admin-usuarios",
    "title": "Activar usuarios y entrar con PIN",
    "image": "/manual/img/admin-usuarios-intro.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3.5,
        "caption": "Inicia sesión con Google y pulsa Activar con esta cuenta.",
        "highlight": {
          "x": 76,
          "y": 39.1,
          "w": 16.1,
          "h": 6.5
        },
        "cursor": {
          "x": 84.1,
          "y": 42.4,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 3.5,
        "caption": "Elige el PIN del administrador.",
        "image": "/manual/img/admin-usuarios-pin.webp",
        "highlight": {
          "x": 37.3,
          "y": 45.6,
          "w": 25.5,
          "h": 6.5
        },
        "cursor": {
          "x": 50.1,
          "y": 48.9
        },
        "type": {
          "x": 38.5,
          "y": 48.9,
          "text": "1234"
        }
      },
      {
        "at": 7,
        "dur": 3.5,
        "caption": "Crea un usuario y parte de un preajuste, por ejemplo Cajero.",
        "image": "/manual/img/admin-usuario-form.webp",
        "highlight": {
          "x": 46.2,
          "y": 40,
          "w": 5,
          "h": 4.9
        },
        "cursor": {
          "x": 48.7,
          "y": 42.5,
          "click": true
        }
      },
      {
        "at": 10.5,
        "dur": 3.5,
        "caption": "La lista muestra al administrador y a cada usuario.",
        "image": "/manual/img/admin-usuarios-lista.webp",
        "highlight": {
          "x": 19,
          "y": 27.7,
          "w": 75.7,
          "h": 32
        },
        "cursor": {
          "x": 56.9,
          "y": 43.7
        }
      },
      {
        "at": 14,
        "dur": 3.5,
        "caption": "Al abrir la app, cada persona elige su tarjeta.",
        "image": "/manual/img/admin-bloqueo.webp",
        "highlight": {
          "x": 25,
          "y": 46.2,
          "w": 50.1,
          "h": 21.2
        },
        "cursor": {
          "x": 50.1,
          "y": 56.8
        }
      },
      {
        "at": 17.5,
        "dur": 3.5,
        "caption": "Un PIN incorrecto cuenta como intento fallido.",
        "image": "/manual/img/admin-bloqueo-error.webp",
        "highlight": {
          "x": 37.3,
          "y": 57.9,
          "w": 25.5,
          "h": 4.2
        },
        "cursor": {
          "x": 50.1,
          "y": 60
        }
      },
      {
        "at": 21,
        "dur": 3.5,
        "caption": "El administrador revisa en el historial quién hizo qué.",
        "image": "/manual/img/admin-auditoria.webp",
        "highlight": {
          "x": 19,
          "y": 28.5,
          "w": 79.6,
          "h": 70.4
        },
        "cursor": {
          "x": 58.8,
          "y": 63.7
        }
      }
    ]
  }
};

export default chapter;
