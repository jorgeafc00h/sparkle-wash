import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "admin-respaldo",
  "order": 405,
  "group": "Administración",
  "title": "Respaldo en Google Drive",
  "summary": "Guarda una copia de tus empresas, clientes, productos y facturas en tu Google Drive y descárgala cuando la necesites.",
  "sections": [
    {
      "id": "requisitos",
      "title": "Requisitos",
      "body": [
        "Exportar a Google Drive (ruta /settings/google-drive) necesita un plan de pago y haber iniciado sesión con Google. Con el plan gratuito la pantalla muestra «Función Pro» con la prueba gratis y «Ver planes»; con plan pero sin sesión de Google dice «Inicia sesión con Google». En Configuración, la tarjeta «Exportar a Google Drive» solo aparece si cumples ambas condiciones.",
        "La primera vez, Google puede pedirte permiso para que la app guarde archivos en tu Drive."
      ],
      "figure": {
        "src": "/manual/img/admin-drive-bloqueado.webp",
        "alt": "Pantalla de Google Drive bloqueada con el aviso Función Pro",
        "caption": "Lo que ve el plan Free."
      }
    },
    {
      "id": "crear",
      "title": "Crear un respaldo",
      "body": [
        "Pulsa «Crear Respaldo». La app sube un archivo JSON con tus empresas, clientes, productos y facturas."
      ],
      "steps": [
        "Pulsa «Crear Respaldo» y espera el mensaje «Subiendo datos a Google Drive…».",
        "Al terminar aparece «Respaldo creado exitosamente» con un enlace «Ver en Google Drive».",
        "La fecha del último respaldo se muestra bajo el botón."
      ],
      "figure": {
        "src": "/manual/img/admin-drive-creado.webp",
        "alt": "Mensaje Respaldo creado exitosamente con enlace Ver en Google Drive",
        "caption": "Respaldo creado (con un servicio de Drive simulado para esta captura)."
      },
      "callout": {
        "kind": "warning",
        "title": "Lo que el respaldo no incluye",
        "body": "El archivo contiene empresas, clientes, productos y facturas. Los tickets del punto de venta, los usuarios locales y los movimientos de caja no forman parte de este respaldo."
      }
    },
    {
      "id": "existentes",
      "title": "Respaldos existentes y descarga",
      "body": [
        "«Respaldos Existentes» lista los archivos de tu Drive cuyo nombre empieza con «SparkleWash_Backup» (el prefijo se conserva por compatibilidad), con su fecha. «Actualizar» vuelve a consultarlos. «Descargar» guarda el archivo JSON en tu computadora.",
        "Esta pantalla no tiene un botón para restaurar: el archivo descargado es tu copia de seguridad."
      ],
      "figure": {
        "src": "/manual/img/admin-drive-listo.webp",
        "alt": "Pantalla de respaldo con el botón Crear Respaldo y dos respaldos existentes con Descargar",
        "caption": "Dos respaldos de ejemplo (lista simulada)."
      }
    }
  ],
  "walkthrough": {
    "id": "admin-respaldo",
    "title": "Crear un respaldo",
    "image": "/manual/img/admin-drive-bloqueado.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3.5,
        "caption": "Con el plan gratuito la función aparece bloqueada.",
        "highlight": {
          "x": 20.4,
          "y": 15.5,
          "w": 76.7,
          "h": 55.5
        },
        "cursor": {
          "x": 58.8,
          "y": 43.3
        }
      },
      {
        "at": 3.5,
        "dur": 3.5,
        "caption": "Con plan de pago y sesión de Google, pulsa Crear Respaldo.",
        "image": "/manual/img/admin-drive-listo.webp",
        "highlight": {
          "x": 84.8,
          "y": 15.5,
          "w": 12.3,
          "h": 6.5
        },
        "cursor": {
          "x": 91,
          "y": 18.8,
          "click": true
        }
      },
      {
        "at": 7,
        "dur": 4,
        "caption": "El archivo se sube a tu Google Drive.",
        "image": "/manual/img/admin-drive-creado.webp",
        "highlight": {
          "x": 21.4,
          "y": 28.1,
          "w": 74.8,
          "h": 4.2
        },
        "cursor": {
          "x": 58.8,
          "y": 30.2
        },
        "toast": "Respaldo creado exitosamente"
      },
      {
        "at": 11,
        "dur": 3.5,
        "caption": "Los respaldos existentes se pueden descargar.",
        "image": "/manual/img/admin-drive-listo.webp",
        "highlight": {
          "x": 18.9,
          "y": 30.2,
          "w": 79.8,
          "h": 30.7
        },
        "cursor": {
          "x": 58.8,
          "y": 45.6
        }
      },
      {
        "at": 14.5,
        "dur": 3.5,
        "caption": "Actualizar vuelve a consultar tu Drive.",
        "highlight": {
          "x": 88.2,
          "y": 32.9,
          "w": 9,
          "h": 6
        },
        "cursor": {
          "x": 92.7,
          "y": 35.9,
          "click": true
        }
      }
    ]
  }
};

export default chapter;
