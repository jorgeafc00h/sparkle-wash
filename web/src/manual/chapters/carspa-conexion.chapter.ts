import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "conexion",
  "order": 120,
  "group": "Car Spa",
  "title": "Conectar con Car Spa",
  "summary": "Configura la URL de la API, el código de caja y tu cuenta de Google, y entiende el estado de sincronización.",
  "sections": [
    {
      "id": "abrir",
      "title": "Abrir la configuración de Car Spa",
      "body": [
        "Todo el trabajo de lavado se sincroniza con la API de Car Spa, la misma que usan la app de iPhone y la consola web. Por eso lo primero es conectar la aplicación."
      ],
      "steps": [
        "En el menú, abre Configuración.",
        "Entra a la tarjeta «Car Spa (lavado)».",
        "En «URL de la API» escribe la dirección de la API de tu Car Spa y pulsa «Guardar».",
        "Pulsa «Probar conexión». Si todo está bien verás «Conexión correcta con la API de Car Spa»."
      ],
      "figure": {
        "src": "/manual/img/carspa-conexion-sin-sesion.webp",
        "alt": "Configuración de Car Spa sin sesión: campo URL de la API, botón Probar conexión y botón Iniciar sesión con Google."
      }
    },
    {
      "id": "google",
      "title": "Iniciar sesión con Google",
      "body": [
        "Pulsa «Iniciar sesión con Google» y elige tu cuenta. Al terminar ves el nombre de tu Car Spa, tu correo y una etiqueta con tu rol: «Solo lectura», «Operador» o «Administrador».",
        "Para crear servicios, cambiar estados y registrar pagos necesitas rol Operador o Administrador. Con «Solo lectura» puedes consultar el tablero. Los roles los define quien administra tu Car Spa.",
        "«Cerrar sesión» desconecta esta computadora."
      ],
      "figure": {
        "src": "/manual/img/carspa-conexion.webp",
        "alt": "Configuración de Car Spa con la sesión iniciada: nombre del Car Spa, correo y etiqueta de rol Operador."
      },
      "callout": {
        "kind": "info",
        "title": "Si el inicio de sesión es rechazado",
        "body": "La API de Car Spa debe aceptar el Client ID de Google de esta aplicación. Si Google acepta tu cuenta pero Car Spa la rechaza, avisa a quien administra la API."
      }
    },
    {
      "id": "caja",
      "title": "Código de caja y opciones del ticket",
      "body": [
        "En «Caja y tickets de trabajo» defines el «Código de caja» (hasta 4 caracteres). Las órdenes salen con ese código, por ejemplo OT-C1-000001. Si lo dejas vacío se usa C1.",
        "Aquí también eliges las copias por ticket (de 1 a 3), si se imprime al crear un servicio, los segundos de sondeo (de 5 a 300; 15 por defecto) y el pie del ticket."
      ],
      "figure": {
        "src": "/manual/img/carspa-caja-tickets.webp",
        "alt": "Configuración: Código de caja, Copias por ticket, Segundos de sondeo, casilla Imprimir el ticket al crear un servicio y Pie del ticket."
      }
    },
    {
      "id": "estado",
      "title": "Estados de sincronización",
      "body": [
        "En la parte superior del tablero de Lavado verás una etiqueta con el estado de la conexión:"
      ],
      "steps": [
        "En vivo: la aplicación recibe los cambios al instante.",
        "Sondeo: el canal en vivo no está disponible y la aplicación consulta al servidor cada cierto número de segundos (el valor «Segundos de sondeo»).",
        "Sin conexión: no hay comunicación con el servidor. Puedes seguir trabajando; lo que hagas queda en cola.",
        "Error de sincronización: el servidor respondió con un error. El mensaje aparece debajo de la etiqueta.",
        "Sin sesión y Conectando…: todavía no has iniciado sesión, o la conexión se está abriendo."
      ],
      "callout": {
        "kind": "info",
        "title": "Pendientes y última sincronización",
        "body": "Junto a la etiqueta aparece «N pendientes» cuando hay trabajo en cola, y «Últ. sync» con la hora de la última sincronización. El botón «Sincronizar» envía lo pendiente y actualiza el tablero."
      }
    }
  ],
  "walkthrough": {
    "id": "carspa-conexion",
    "title": "Conectar con Car Spa",
    "image": "/manual/img/carspa-conexion-sin-sesion.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 4,
        "caption": "Entra a Configuración → Car Spa (lavado).",
        "image": "/manual/img/carspa-conexion-sin-sesion.webp",
        "highlight": {
          "x": 20.1,
          "y": 5.2,
          "w": 54.7,
          "h": 7.5
        },
        "cursor": {
          "x": 47.5,
          "y": 8.9,
          "click": false
        }
      },
      {
        "at": 4,
        "dur": 5,
        "caption": "Escribe la URL de la API de tu Car Spa.",
        "highlight": {
          "x": 20.1,
          "y": 5.2,
          "w": 54.7,
          "h": 7.5
        },
        "cursor": {
          "x": 47.5,
          "y": 8.9,
          "click": true
        }
      },
      {
        "at": 9,
        "dur": 4,
        "caption": "Pulsa «Probar conexión»: debe decir «Conexión correcta con la API de Car Spa».",
        "highlight": {
          "x": 20.1,
          "y": 12.2,
          "w": 12.7,
          "h": 7.0
        },
        "cursor": {
          "x": 26.5,
          "y": 15.7,
          "click": true
        },
        "toast": "Conexión correcta"
      },
      {
        "at": 13,
        "dur": 4,
        "caption": "Pulsa «Iniciar sesión con Google» y elige tu cuenta.",
        "highlight": {
          "x": 20.1,
          "y": 31.4,
          "w": 16.9,
          "h": 7.0
        },
        "cursor": {
          "x": 28.6,
          "y": 34.9,
          "click": true
        }
      },
      {
        "at": 17,
        "dur": 5,
        "caption": "Listo: la cuenta queda conectada y ves tu rol.",
        "image": "/manual/img/carspa-conexion.webp",
        "highlight": {
          "x": 20.1,
          "y": 31.1,
          "w": 54.7,
          "h": 7.3
        },
        "cursor": {
          "x": 47.5,
          "y": 34.8,
          "click": false
        }
      }
    ]
  }
};

export default chapter;
