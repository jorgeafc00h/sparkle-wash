import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "tablero",
  "order": 130,
  "group": "Car Spa",
  "title": "Tablero de servicios",
  "summary": "El tablero «Lavado» muestra cada vehículo desde que llega hasta que termina.",
  "sections": [
    {
      "id": "columnas",
      "title": "Columnas y estados",
      "body": [
        "Abre «Lavado» en el menú. El tablero tiene cuatro columnas, en este orden: Llegó, En cola, En proceso y Listo (hoy). Un servicio avanza de izquierda a derecha.",
        "La columna «Listo (hoy)» solo muestra los servicios terminados el día de hoy (hora de El Salvador). Los servicios cancelados salen del tablero.",
        "Los cambios hechos desde la app de iPhone o la consola web aparecen en el tablero por sí solos."
      ],
      "figure": {
        "src": "/manual/img/carspa-tablero.webp",
        "alt": "Tablero de Lavado con servicios en las columnas Llegó, En cola, En proceso y Listo (hoy), y las tarjetas de resumen arriba."
      }
    },
    {
      "id": "tarjeta",
      "title": "Qué muestra cada tarjeta",
      "body": [
        "Arriba, cuatro contadores: En sitio, En proceso, Listos hoy y Por cobrar. Debajo hay un buscador por placa o número de orden.",
        "Cada tarjeta muestra la placa, el paquete, el número de orden (o «Sin orden») y un cronómetro. El cronómetro cuenta desde la llegada del vehículo y se detiene cuando el servicio está listo; pasa el cursor para ver la hora de ingreso.",
        "Las etiquetas de la tarjeta indican el cobro («Por cobrar $», «Abono $» o «Pagado»), si el servicio está «Pendiente de sync» o tiene «Error de sync», y el nombre del cliente si lo hay. Más abajo se lista el empleado asignado o «Sin empleado»."
      ]
    },
    {
      "id": "avanzar",
      "title": "Avanzar un servicio",
      "body": [
        "El botón principal de cada tarjeta cambia según el estado:"
      ],
      "steps": [
        "En «Llegó»: «A la cola».",
        "En «En cola»: «Iniciar».",
        "En «En proceso»: «Terminar».",
        "Cuando el servicio ya está listo, el botón principal desaparece.",
        "«Cobrar» aparece junto al botón principal mientras el servicio tenga saldo pendiente, en cualquier etapa, y abre la caja con el servicio cargado."
      ]
    },
    {
      "id": "asignar",
      "title": "Asignar un empleado",
      "body": [
        "Pulsa el icono de persona de la tarjeta, elige al empleado en la lista y confirma con «Asignar». Aparece el aviso «Empleado asignado». La lista contiene los empleados activos de tu Car Spa; el icono no está disponible en servicios ya terminados."
      ],
      "figure": {
        "src": "/manual/img/carspa-asignar.webp",
        "alt": "Ventana Asignar empleado con la lista de empleados y el botón Asignar."
      }
    },
    {
      "id": "cancelar",
      "title": "Cancelar un servicio",
      "body": [
        "Pulsa la X de la tarjeta. La aplicación pregunta «¿Cancelar el servicio de …?» y avisa que no se puede deshacer. Elige «Cancelar servicio» para confirmar o «Volver» para dejarlo como estaba. Solo se puede cancelar un servicio que aún no está listo."
      ],
      "figure": {
        "src": "/manual/img/carspa-cancelar.webp",
        "alt": "Cuadro de confirmación Cancelar servicio con los botones Cancelar servicio y Volver."
      }
    }
  ],
  "walkthrough": {
    "id": "carspa-tablero",
    "title": "Tablero de servicios",
    "image": "/manual/img/carspa-tablero.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 4,
        "caption": "El tablero tiene cuatro columnas: Llegó, En cola, En proceso y Listo (hoy).",
        "image": "/manual/img/carspa-tablero.webp",
        "highlight": {
          "x": 19.3,
          "y": 34.4,
          "w": 79.0,
          "h": 62.2
        },
        "cursor": {
          "x": 58.8,
          "y": 65.5,
          "click": false
        }
      },
      {
        "at": 4,
        "dur": 4,
        "caption": "Cada tarjeta muestra placa, paquete, número de orden, cronómetro y estado de cobro.",
        "highlight": {
          "x": 59.4,
          "y": 34.4,
          "w": 18.9,
          "h": 32.0
        },
        "cursor": {
          "x": 68.8,
          "y": 50.4,
          "click": false
        }
      },
      {
        "at": 8,
        "dur": 4,
        "caption": "«A la cola», «Iniciar» y «Terminar» avanzan el servicio al siguiente estado.",
        "highlight": {
          "x": 40.1,
          "y": 53.5,
          "w": 8.0,
          "h": 7.0
        },
        "cursor": {
          "x": 44.1,
          "y": 57.0,
          "click": true
        }
      },
      {
        "at": 12,
        "dur": 4,
        "caption": "El icono de persona asigna un empleado.",
        "highlight": {
          "x": 43.5,
          "y": 58.7,
          "w": 4.5,
          "h": 6.2
        },
        "cursor": {
          "x": 45.8,
          "y": 61.8,
          "click": true
        }
      },
      {
        "at": 16,
        "dur": 4,
        "caption": "Elige el empleado y confirma con «Asignar».",
        "image": "/manual/img/carspa-asignar.webp",
        "highlight": {
          "x": 36.9,
          "y": 47.3,
          "w": 26.2,
          "h": 7.5
        },
        "cursor": {
          "x": 50.0,
          "y": 51.0,
          "click": false
        },
        "toast": "Empleado asignado"
      },
      {
        "at": 20,
        "dur": 4,
        "caption": "La X cancela el servicio y pide confirmación.",
        "image": "/manual/img/carspa-cancelar.webp"
      }
    ]
  }
};

export default chapter;
