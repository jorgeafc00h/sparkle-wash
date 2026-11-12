import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "admin-bienvenida",
  "order": 400,
  "group": "Administración",
  "title": "Bienvenida y primera empresa",
  "summary": "Abre la aplicación por primera vez, recorre la presentación y registra la empresa con la que vas a trabajar.",
  "sections": [
    {
      "id": "entrada",
      "title": "La pantalla de bienvenida",
      "body": [
        "La primera vez que abres Car Spa aparece la pantalla de bienvenida (ruta /welcome). Tienes dos caminos: «Iniciar sesión con Google», para tener tu cuenta ligada a la app (necesaria para el asistente, el respaldo en Google Drive, el control de usuarios y la sincronización), o «Continuar sin iniciar sesión», que usa la versión gratuita en modo invitado.",
        "La propia pantalla resume los planes: el plan gratis incluye 1 empresa, facturación y compras, con algunas funciones que muestran un anuncio breve antes de continuar; el plan Pro agrega multiempresa, sin anuncios, exportación a Google Drive, PDF por lotes y respaldo en la nube. Más adelante puedes iniciar sesión desde Inicio o Perfil."
      ],
      "figure": {
        "src": "/manual/img/admin-bienvenida.webp",
        "alt": "Pantalla de bienvenida con los botones Iniciar sesión con Google y Continuar sin iniciar sesión",
        "caption": "Bienvenida: Google o modo invitado."
      }
    },
    {
      "id": "tour",
      "title": "La presentación de cinco pasos",
      "body": [
        "Después de la bienvenida (ruta /onboarding) se muestra una presentación corta de cinco pasos: qué es Car Spa, cómo gestionar varios emisores, cómo importar los DTE recibidos desde Gmail, los reportes fiscales en un clic y cómo empezar gratis."
      ],
      "steps": [
        "Pulsa Siguiente para avanzar; con la flecha de la izquierda regresas un paso. También puedes tocar los puntos para saltar a un paso.",
        "Pulsa Omitir (arriba a la derecha) si no quieres verla. Al terminar o al omitir llegas a Inicio."
      ],
      "figure": {
        "src": "/manual/img/admin-onboarding-2.webp",
        "alt": "Tercer paso de la presentación: importar DTE recibidos desde Gmail",
        "caption": "Paso 3 de 5 de la presentación."
      }
    },
    {
      "id": "sin-empresa",
      "title": "Sin empresa todo está bloqueado",
      "body": [
        "Si todavía no hay ninguna empresa, Inicio muestra «Configura tu primera empresa» con el botón «Configurar empresa». Facturas, Clientes, Productos, Lavado, el punto de venta, Compras y demás opciones aparecen con un candado en el menú y, si las tocas, la app avisa «Debe configurar una empresa antes de acceder a…». Inicio, Empresas, Catálogos, Configuración, Perfil y el chat siguen disponibles."
      ],
      "figure": {
        "src": "/manual/img/admin-inicio-sin-empresa.webp",
        "alt": "Inicio sin empresa con el botón Configurar empresa y opciones bloqueadas",
        "caption": "Inicio de una instalación nueva."
      }
    },
    {
      "id": "crear",
      "title": "Crear la primera empresa",
      "body": [
        "Entra por Configurar empresa o por Empresas → Nueva Empresa (ruta /companies/add). El asistente tiene cuatro pasos y se avanza con Siguiente."
      ],
      "steps": [
        "Información básica: Nombre legal, Nombre comercial, NIT y NRC.",
        "Contacto y ubicación: correo, teléfono, dirección y los datos de departamento, municipio y distrito.",
        "Actividad económica: elige la actividad del catálogo de Hacienda y el tipo de establecimiento.",
        "Certificado: carga del certificado digital con su contraseña. Si el certificado no se pudiera guardar, la empresa se crea igual y el certificado se configura después desde la pantalla de la empresa.",
        "Al terminar aparece «Empresa … creada correctamente». Desde ese momento se desbloquea el menú."
      ],
      "figure": {
        "src": "/manual/img/admin-empresa-nueva.webp",
        "alt": "Asistente Nueva Empresa en el paso Información básica con nombre, NIT y NRC",
        "caption": "Paso 1 del asistente de empresa (datos de ejemplo)."
      },
      "callout": {
        "kind": "info",
        "title": "Más sobre la empresa",
        "body": "El certificado, las credenciales de Hacienda, el ambiente de pruebas y la solicitud de producción se explican en los capítulos de Facturación electrónica."
      }
    },
    {
      "id": "limite",
      "title": "Cuántas empresas permite tu plan",
      "body": [
        "El plan Free permite 1 empresa; el plan Pro, hasta 2; el plan Business y los superiores, ilimitadas. Cuando llegas al límite, el botón Nueva Empresa se desactiva, la lista muestra «Tu plan Free permite hasta 1 empresa…» con el botón «Ver planes», y la pantalla de nueva empresa dice «Límite de empresas de tu plan alcanzado»."
      ],
      "figure": {
        "src": "/manual/img/admin-empresas-lista.webp",
        "alt": "Lista de empresas con el aviso de límite del plan Free y el botón Ver planes",
        "caption": "Aviso de límite de empresas en el plan Free."
      }
    }
  ],
  "walkthrough": {
    "id": "admin-bienvenida",
    "title": "De la bienvenida a tu primera empresa",
    "image": "/manual/img/admin-bienvenida.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3.5,
        "caption": "Elige iniciar sesión con Google o continuar como invitado.",
        "highlight": {
          "x": 60.6,
          "y": 59.5,
          "w": 28.8,
          "h": 7.6
        },
        "cursor": {
          "x": 75,
          "y": 63.3,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 3,
        "caption": "La presentación tiene cinco pasos; avanza con Siguiente.",
        "image": "/manual/img/admin-onboarding.webp",
        "highlight": {
          "x": 57.8,
          "y": 64.3,
          "w": 26,
          "h": 8.3
        },
        "cursor": {
          "x": 70.8,
          "y": 68.5,
          "click": true
        }
      },
      {
        "at": 6.5,
        "dur": 3,
        "caption": "O pulsa Omitir cuando quieras.",
        "image": "/manual/img/admin-onboarding-2.webp",
        "highlight": {
          "x": 93.1,
          "y": 1.8,
          "w": 5.6,
          "h": 5.7
        },
        "cursor": {
          "x": 95.9,
          "y": 4.7,
          "click": true
        }
      },
      {
        "at": 9.5,
        "dur": 3.5,
        "caption": "Sin empresa, Inicio te pide configurar la primera.",
        "image": "/manual/img/admin-inicio-sin-empresa.webp",
        "highlight": {
          "x": 25.7,
          "y": 24.3,
          "w": 14.4,
          "h": 6.5
        },
        "cursor": {
          "x": 32.9,
          "y": 27.6,
          "click": true
        }
      },
      {
        "at": 13,
        "dur": 3.5,
        "caption": "En Empresas, agrega la primera con Nueva Empresa.",
        "image": "/manual/img/admin-empresas-vacio.webp",
        "highlight": {
          "x": 86.2,
          "y": 2.3,
          "w": 12.5,
          "h": 6.5
        },
        "cursor": {
          "x": 92.5,
          "y": 5.6,
          "click": true
        }
      },
      {
        "at": 16.5,
        "dur": 4,
        "caption": "Completa nombre, NIT y NRC, y sigue los cuatro pasos.",
        "image": "/manual/img/admin-empresa-nueva.webp",
        "highlight": {
          "x": 33.7,
          "y": 2.3,
          "w": 50.1,
          "h": 71.6
        },
        "cursor": {
          "x": 58.8,
          "y": 38.1
        },
        "zoom": {
          "x": 18.7,
          "y": 15.6,
          "w": 80.2,
          "h": 45.1
        }
      }
    ]
  }
};

export default chapter;
