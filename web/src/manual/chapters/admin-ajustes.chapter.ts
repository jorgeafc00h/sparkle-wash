import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "admin-ajustes",
  "order": 407,
  "group": "Administración",
  "title": "Ajustes generales",
  "summary": "El centro de Configuración: de dónde se llega a cada ajuste, catálogos, categorías y datos de la app.",
  "sections": [
    {
      "id": "tarjetas",
      "title": "La pantalla de Configuración",
      "body": [
        "Configuración (ruta /settings) reúne los ajustes en tarjetas: Usuarios y permisos, Car Spa (lavado), Empresas, Catálogos, Sincronización entre dispositivos, Categorías de Productos, Registros de Sincronización, Perfil y Cuenta (con la etiqueta de tu plan). Si tu plan lo permite y has iniciado sesión con Google, se agrega «Exportar a Google Drive».",
        "Las tarjetas a las que tu usuario no tiene acceso aparecen atenuadas con la nota «Sin permiso — pide acceso al administrador».",
        "Al final están Registros del Sistema (ver capítulo Asistente y soporte) e «Información de la App»: la versión de la aplicación (por ejemplo 1.1.0) y el derecho de autor."
      ],
      "figure": {
        "src": "/manual/img/admin-ajustes.webp",
        "alt": "Pantalla de Configuración con las tarjetas de ajustes y la etiqueta del plan",
        "caption": "Configuración de una cuenta con plan Pro."
      },
      "callout": {
        "kind": "info",
        "title": "Dónde está cada cosa",
        "body": "La impresora de tickets se abre desde el botón Impresora de la pantalla de venta (ver Impresora térmica del recibo). La conexión de Car Spa, los empleados y los tickets de trabajo están en la tarjeta Car Spa (lavado) y se explican en los capítulos de Car Spa."
      }
    },
    {
      "id": "catalogos",
      "title": "Catálogos del Ministerio de Hacienda",
      "body": [
        "Catálogos (ruta /settings/catalogs) lista los catálogos oficiales que usa la facturación: tipos de documento, departamentos, municipios, operaciones especiales, motivos de evento… Busca por código, nombre u opción y entra a uno para ver y filtrar sus valores. «Sincronizar Catálogos» los actualiza; la fecha de la última sincronización aparece arriba. No necesitas editarlos: se alimentan de Hacienda."
      ],
      "figure": {
        "src": "/manual/img/admin-catalogos.webp",
        "alt": "Lista de catálogos de Hacienda con buscador y botón Sincronizar Catálogos",
        "caption": "Catálogos disponibles en la app."
      }
    },
    {
      "id": "categorias",
      "title": "Categorías de productos",
      "body": [
        "Categorías de Productos (ruta /settings/categories) organiza tu catálogo y filtra la lista de productos; la pantalla de venta filtra por la categoría que tiene cada producto."
      ],
      "steps": [
        "Escribe el nombre de la categoría (por ejemplo Limpieza) y agrégala.",
        "Usa el icono Renombrar para cambiarla. Un nombre repetido se rechaza.",
        "Eliminar solo es posible cuando ningún producto la usa; si la usan, la app indica cuántos productos."
      ],
      "figure": {
        "src": "/manual/img/admin-categorias.webp",
        "alt": "Pantalla de categorías de productos con el campo para agregar una categoría",
        "caption": "Categorías de productos."
      }
    }
  ],
  "walkthrough": {
    "id": "admin-ajustes",
    "title": "Moverte por Configuración",
    "image": "/manual/img/admin-ajustes.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3.5,
        "caption": "Usuarios y permisos: PIN y control de acceso.",
        "highlight": {
          "x": 18.9,
          "y": 12.8,
          "w": 26.4,
          "h": 19.3
        },
        "cursor": {
          "x": 32.1,
          "y": 22.5,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 3.5,
        "caption": "Car Spa (lavado): conexión y tickets de trabajo.",
        "highlight": {
          "x": 45.6,
          "y": 12.8,
          "w": 26.4,
          "h": 19.3
        },
        "cursor": {
          "x": 58.8,
          "y": 22.5,
          "click": true
        }
      },
      {
        "at": 7,
        "dur": 3.5,
        "caption": "Sincronización entre dispositivos, para Pro+Sync.",
        "highlight": {
          "x": 45.6,
          "y": 32.6,
          "w": 26.4,
          "h": 19.3
        },
        "cursor": {
          "x": 58.8,
          "y": 42.3,
          "click": true
        }
      },
      {
        "at": 10.5,
        "dur": 3.5,
        "caption": "Categorías de Productos.",
        "highlight": {
          "x": 72.3,
          "y": 32.6,
          "w": 26.4,
          "h": 19.3
        },
        "cursor": {
          "x": 85.5,
          "y": 42.3,
          "click": true
        }
      },
      {
        "at": 14,
        "dur": 3.5,
        "caption": "Los catálogos de Hacienda se actualizan con Sincronizar Catálogos.",
        "image": "/manual/img/admin-catalogos.webp",
        "highlight": {
          "x": 18.9,
          "y": 2.3,
          "w": 79.8,
          "h": 48.9
        },
        "cursor": {
          "x": 58.8,
          "y": 26.8
        }
      }
    ]
  }
};

export default chapter;
