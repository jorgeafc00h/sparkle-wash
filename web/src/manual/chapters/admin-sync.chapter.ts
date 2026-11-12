import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "admin-sync",
  "order": 404,
  "group": "Administración",
  "title": "Sincronización entre dispositivos",
  "summary": "Mantén teléfono y computadora al día con Pro+Sync, y consulta el historial de envíos a Hacienda.",
  "sections": [
    {
      "id": "plan",
      "title": "Quién puede sincronizar",
      "body": [
        "Configuración → Sincronización entre dispositivos (ruta /settings/sync) está disponible solo en Pro+Sync y Enterprise. Con otros planes la pantalla muestra «Sincronización entre dispositivos» bloqueada, con «Iniciar prueba gratis de 2 meses» (sin tarjeta; incluye también las funciones Pro) y «Mejorar a Pro+Sync». Mientras no tengas el plan, la app no genera tráfico de sincronización."
      ],
      "figure": {
        "src": "/manual/img/admin-sync-bloqueado.webp",
        "alt": "Sincronización bloqueada con el botón Iniciar prueba gratis de 2 meses",
        "caption": "Lo que ve un plan sin sincronización."
      }
    },
    {
      "id": "panel",
      "title": "El panel de sincronización",
      "body": [
        "Con el plan, el panel muestra la empresa, el estado («Sin sesión activa», sincronizando…), la Última sincronización y los Cambios pendientes de enviar.",
        "La sincronización trabaja en ráfagas: «Sincronizar ahora» abre una sesión que se cierra sola tras unos 90 segundos sin actividad. Tus datos siempre quedan guardados en cada dispositivo.",
        "La empresa debe estar vinculada (reclamada con sus credenciales de Hacienda) para que el servicio la autorice; las empresas de prueba se vinculan a través de su empresa de producción con el mismo NIT. En Dispositivos aparecen los otros dispositivos de esa empresa; si hay más de uno, un interruptor «Automático» permite ráfagas en segundo plano.",
        "Si hay conflictos, cambios rechazados o documentos «Pendiente de verificar», el panel los lista aparte para que los revises."
      ],
      "steps": [
        "Pulsa «Sincronizar ahora» después de hacer cambios en un dispositivo.",
        "Abre la app en el otro dispositivo con la misma cuenta y pulsa «Sincronizar ahora» allí.",
        "Revisa que Cambios pendientes de enviar regrese a 0."
      ],
      "figure": {
        "src": "/manual/img/admin-sync-panel.webp",
        "alt": "Panel de sincronización con estado, Sincronizar ahora, empresa y cuenta, y dispositivos",
        "caption": "Panel sin otros dispositivos registrados todavía."
      },
      "callout": {
        "kind": "info",
        "title": "Qué se sincroniza",
        "body": "Por diseño de la sincronización v2, las ventas del punto de venta (tickets) se incluyen entre las entidades que viajan entre dispositivos. En este manual no se pudo comprobar con un servicio real ni con un segundo dispositivo; el panel de la captura es el de una cuenta sin dispositivos."
      }
    },
    {
      "id": "registros",
      "title": "Registros de sincronización (envíos a Hacienda)",
      "body": [
        "No confundir con lo anterior. «Registros de Sincronización» (ruta /settings/sync-logs) es el historial de envíos al Ministerio de Hacienda: Fecha / Hora, Tipo, Dirección, Código de respuesta y Error. Un código 2xx va en verde; 4xx o 5xx, en rojo, con el mensaje. Filtra con «Filtrar por fecha». Los registros se guardan en esta computadora."
      ],
      "figure": {
        "src": "/manual/img/admin-sync-logs.webp",
        "alt": "Registros de sincronización con dos envíos correctos y uno con error 503",
        "caption": "Registros de ejemplo (datos ficticios)."
      }
    }
  ],
  "walkthrough": {
    "id": "admin-sync",
    "title": "Sincronizar dispositivos",
    "image": "/manual/img/admin-sync-bloqueado.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 4,
        "caption": "Sin el plan, la pantalla invita a la prueba gratis de 2 meses.",
        "highlight": {
          "x": 49.6,
          "y": 40.5,
          "w": 18.4,
          "h": 6.5
        },
        "cursor": {
          "x": 58.8,
          "y": 43.8,
          "click": true
        }
      },
      {
        "at": 4,
        "dur": 3.5,
        "caption": "Con Pro+Sync ves el estado y los cambios pendientes.",
        "image": "/manual/img/admin-sync-panel.webp",
        "highlight": {
          "x": 88.1,
          "y": 15.5,
          "w": 9,
          "h": 4.9
        },
        "cursor": {
          "x": 92.6,
          "y": 18
        }
      },
      {
        "at": 7.5,
        "dur": 3.5,
        "caption": "Pulsa Sincronizar ahora.",
        "highlight": {
          "x": 20.4,
          "y": 29.8,
          "w": 13.9,
          "h": 6.5
        },
        "cursor": {
          "x": 27.4,
          "y": 33.1,
          "click": true
        }
      },
      {
        "at": 11,
        "dur": 3.5,
        "caption": "La empresa debe estar vinculada para sincronizar.",
        "highlight": {
          "x": 18.9,
          "y": 44.3,
          "w": 79.8,
          "h": 12.8
        },
        "cursor": {
          "x": 58.8,
          "y": 50.7
        }
      },
      {
        "at": 14.5,
        "dur": 3.5,
        "caption": "Aquí aparecen los demás dispositivos.",
        "highlight": {
          "x": 18.9,
          "y": 62.2,
          "w": 79.8,
          "h": 9.6
        },
        "cursor": {
          "x": 58.8,
          "y": 67
        }
      },
      {
        "at": 18,
        "dur": 3.5,
        "caption": "Los envíos a Hacienda tienen su propio historial.",
        "image": "/manual/img/admin-sync-logs.webp",
        "highlight": {
          "x": 18.9,
          "y": 2.3,
          "w": 79.8,
          "h": 47.3
        },
        "cursor": {
          "x": 58.8,
          "y": 26
        }
      }
    ]
  }
};

export default chapter;
