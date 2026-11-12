import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "primer-inicio",
  "order": 110,
  "group": "Car Spa",
  "title": "Primer inicio y cuenta",
  "summary": "Qué ves al abrir la aplicación por primera vez y qué necesitas antes de trabajar.",
  "sections": [
    {
      "id": "bienvenida",
      "title": "La pantalla de bienvenida",
      "body": [
        "Al abrir la aplicación por primera vez aparece «¡Bienvenido!» con dos opciones: «Iniciar sesión con Google» para sincronizar tus datos en todos tus dispositivos, o «Continuar sin iniciar sesión» para usar la versión gratis.",
        "Si continúas sin cuenta, la aplicación te muestra unas diapositivas de presentación. Puedes pulsar «Omitir», avanzar con «Siguiente» y terminar con «Comenzar».",
        "Esta cuenta de Google es la de la aplicación de escritorio (planes y respaldo). La cuenta con la que trabajas en Car Spa se configura aparte, en Configuración → Car Spa (lavado); lo explica el capítulo siguiente."
      ],
      "figure": {
        "src": "/manual/img/carspa-bienvenida.webp",
        "alt": "Pantalla de bienvenida de Car Spa con los botones Iniciar sesión con Google y Continuar sin iniciar sesión."
      }
    },
    {
      "id": "menu",
      "title": "El menú lateral",
      "body": [
        "A la izquierda está el menú. En la sección «Punto de venta» encuentras Lavado (el tablero de servicios), Nueva venta (la caja), Tickets, Cierre de caja y Consolidar. Más abajo hay secciones para documentos y finanzas, y Configuración.",
        "Lavado, Nueva venta y otras opciones trabajan sobre una empresa. Antes de usarlas debe haber una empresa configurada en la aplicación."
      ],
      "figure": {
        "src": "/manual/img/carspa-inicio.webp",
        "alt": "Pantalla de inicio de Car Spa con el menú lateral; la opción Lavado está en la sección Punto de venta."
      }
    },
    {
      "id": "usuarios",
      "title": "Usuarios y permisos",
      "body": [
        "La aplicación permite crear usuarios locales con PIN y permisos por pantalla. Existe un perfil «Cajero» que incluye Lavado, Nueva venta, Tickets y Clientes. Se administran en Configuración → Usuarios y permisos.",
        "Si no ves «Lavado» en el menú, tu usuario no tiene el permiso «Lavado (órdenes de trabajo)»."
      ],
      "figure": {
        "src": "/manual/img/carspa-configuracion.webp",
        "alt": "Pantalla de Configuración con la tarjeta Car Spa (lavado).",
        "caption": "Configuración: la tarjeta «Car Spa (lavado)» abre la conexión con la API."
      }
    }
  ],
  "walkthrough": {
    "id": "carspa-primer-inicio",
    "title": "Primer inicio",
    "image": "/manual/img/carspa-bienvenida.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 4,
        "caption": "Al abrir Car Spa por primera vez ves la pantalla de bienvenida.",
        "image": "/manual/img/carspa-bienvenida.webp"
      },
      {
        "at": 4,
        "dur": 4,
        "caption": "Elige «Iniciar sesión con Google» o «Continuar sin iniciar sesión»."
      },
      {
        "at": 8,
        "dur": 5,
        "caption": "Ya dentro, el menú lateral muestra «Lavado» y «Nueva venta» en la sección Punto de venta.",
        "image": "/manual/img/carspa-inicio.webp",
        "highlight": {
          "x": 0,
          "y": 43.3,
          "w": 18.5,
          "h": 7.8
        },
        "cursor": {
          "x": 9.2,
          "y": 47.2,
          "click": false
        }
      },
      {
        "at": 13,
        "dur": 5,
        "caption": "Configuración reúne la conexión con Car Spa, impresora y usuarios.",
        "image": "/manual/img/carspa-configuracion.webp",
        "highlight": {
          "x": 45.2,
          "y": 12.2,
          "w": 27.1,
          "h": 20.3
        },
        "cursor": {
          "x": 58.8,
          "y": 22.4,
          "click": false
        }
      }
    ]
  }
};

export default chapter;
