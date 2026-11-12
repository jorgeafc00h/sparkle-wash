import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "ayuda",
  "order": 180,
  "group": "Car Spa",
  "title": "Solución de problemas y preguntas frecuentes",
  "summary": "Respuestas rápidas a lo que más se pregunta.",
  "sections": [
    {
      "id": "faq",
      "title": "Preguntas frecuentes",
      "body": [
        "No veo la opción «Lavado» en el menú. Tu usuario local no tiene el permiso de Lavado, o no hay una empresa configurada. Pide a quien administra Usuarios y permisos que lo active.",
        "El tablero dice «Car Spa no está conectado». Aún no has iniciado sesión: abre Configuración → Car Spa (lavado) y pulsa «Iniciar sesión con Google».",
        "El inicio de sesión con Google es rechazado. Revisa la URL de la API y que la API de Car Spa acepte el Client ID de la aplicación. Si el problema sigue, avisa a quien administra la API.",
        "«Probar conexión» falla. Verifica la URL de la API (sin espacios) y tu conexión a internet.",
        "La etiqueta dice «Sondeo». No es un error: el canal en vivo no está disponible y la aplicación consulta al servidor cada cierto número de segundos.",
        "La etiqueta dice «Error de sincronización». El servidor respondió con un error y el mensaje aparece debajo de la etiqueta. Pulsa «Sincronizar» para reintentar.",
        "Una tarjeta muestra «Error de sync». El servidor rechazó esa operación; pasa el cursor sobre la etiqueta para leer el motivo. Ver «Trabajar sin conexión».",
        "No se imprimió el ticket. El servicio sí se guardó. Revisa Configuración → Impresora de tickets (conexión, driver, IP) y reimprime con el icono de impresora de la tarjeta.",
        "Mi sesión se cerró sola. Si la sesión caduca, la aplicación intenta renovarla una vez. Si no lo logra, vuelve a iniciar sesión; lo pendiente sigue en cola.",
        "No puedo crear servicios. Revisa tu rol en Configuración → Car Spa (lavado): «Solo lectura» no permite crear ni cobrar."
      ]
    },
    {
      "id": "antes-de-llamar",
      "title": "Antes de pedir ayuda",
      "body": [
        "Anota la etiqueta de estado del tablero, el mensaje de error que aparece y el número de orden del servicio afectado. Esos tres datos aceleran la solución."
      ],
      "figure": {
        "src": "/manual/img/carspa-conexion.webp",
        "alt": "Configuración de Car Spa con la URL de la API y la sesión iniciada."
      }
    }
  ],
  "walkthrough": {
    "id": "carspa-ayuda",
    "title": "Solución de problemas",
    "image": "/manual/img/carspa-tablero.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 4,
        "caption": "Mira primero la etiqueta de estado en la cabecera del tablero.",
        "image": "/manual/img/carspa-tablero.webp",
        "highlight": {
          "x": 66.2,
          "y": 2.7,
          "w": 11.9,
          "h": 5.2
        },
        "cursor": {
          "x": 72.2,
          "y": 5.3,
          "click": false
        }
      },
      {
        "at": 4,
        "dur": 4,
        "caption": "Si no ves servicios, pulsa «Sincronizar».",
        "highlight": {
          "x": 87.1,
          "y": 1.8,
          "w": 12.0,
          "h": 7.0
        },
        "cursor": {
          "x": 93.1,
          "y": 5.3,
          "click": false
        }
      },
      {
        "at": 8,
        "dur": 5,
        "caption": "Revisa en Configuración → Car Spa (lavado) la URL y la sesión.",
        "image": "/manual/img/carspa-conexion.webp",
        "highlight": {
          "x": 20.1,
          "y": 5.0,
          "w": 54.7,
          "h": 7.5
        },
        "cursor": {
          "x": 47.5,
          "y": 8.8,
          "click": false
        }
      }
    ]
  }
};

export default chapter;
