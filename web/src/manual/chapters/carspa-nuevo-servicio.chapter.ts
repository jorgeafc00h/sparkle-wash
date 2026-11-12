import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "nuevo-servicio",
  "order": 140,
  "group": "Car Spa",
  "title": "Nuevo servicio y ticket de trabajo",
  "summary": "Registra un vehículo que llega y entrega su orden de trabajo impresa.",
  "sections": [
    {
      "id": "crear",
      "title": "Crear un servicio",
      "body": [
        "Desde el tablero, pulsa «Nuevo servicio». Completa la ventana de arriba hacia abajo:"
      ],
      "steps": [
        "Placa. Se convierte a mayúsculas y solo acepta letras, números y guion, hasta 10 caracteres. Necesitas al menos 3 letras o números (el guion no cuenta).",
        "Tipo de vehículo. Las opciones vienen del catálogo de tu Car Spa.",
        "Paquete. Cada paquete muestra su precio para el tipo de vehículo elegido; si un paquete no tiene precio para ese tipo, aparece deshabilitado.",
        "Empleado, Cliente (hasta 80 caracteres) y Nota (hasta 200) son opcionales.",
        "Pulsa «Crear e imprimir ticket» (o «Crear servicio» si la impresión automática está apagada)."
      ],
      "figure": {
        "src": "/manual/img/carspa-nuevo-servicio.webp",
        "alt": "Ventana Nuevo servicio con la placa P123-456, tipo Camioneta / SUV, paquete Supreme Spa y los campos opcionales."
      },
      "callout": {
        "kind": "info",
        "title": "Sin catálogo",
        "body": "Si la ventana dice «Sin paquetes en caché», conéctate y pulsa «Sincronizar» para descargar el catálogo."
      }
    },
    {
      "id": "numero",
      "title": "El número de orden",
      "body": [
        "Cada servicio recibe un número de orden con el formato OT-C1-000045: OT, el código de caja y un consecutivo de 6 dígitos. Aparece en la tarjeta y en el ticket.",
        "Un vehículo no puede tener dos servicios abiertos a la vez: si ya existe uno con la misma placa, el servidor rechaza el nuevo."
      ]
    },
    {
      "id": "ticket",
      "title": "El ticket de trabajo",
      "body": [
        "Si «Imprimir el ticket al crear un servicio» está activo, el ticket sale al crear el servicio. Dice «ORDEN DE TRABAJO» e incluye el número de orden, la placa, el tipo de vehículo, el paquete y sus servicios, el empleado, el cliente, la nota, la fecha de ingreso, el precio con su estado de pago (por ejemplo «PENDIENTE DE PAGO»), la leyenda «Documento no fiscal — no es factura ni DTE» y el pie configurado.",
        "En «Copias por ticket» puedes pedir 1, 2 o 3 copias. Con varias copias cada una lleva su etiqueta: COPIA CLIENTE, COPIA VEHÍCULO y COPIA CAJA.",
        "Para reimprimir, pulsa el icono de impresora de la tarjeta. En Configuración → Car Spa (lavado), «Imprimir ticket de prueba» muestra una vista previa."
      ],
      "figure": {
        "src": "/manual/img/carspa-ticket-trabajo.webp",
        "alt": "Vista previa del ticket de trabajo de prueba con el encabezado ORDEN DE TRABAJO."
      },
      "callout": {
        "kind": "info",
        "title": "Si no hay impresora",
        "body": "El servicio se guarda aunque el ticket no se imprima; la aplicación avisa «No se imprimió». Configura la impresora en Configuración → Impresora de tickets."
      }
    }
  ],
  "walkthrough": {
    "id": "carspa-nuevo-servicio",
    "title": "Nuevo servicio y ticket",
    "image": "/manual/img/carspa-tablero.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3,
        "caption": "Pulsa «Nuevo servicio» en el tablero.",
        "image": "/manual/img/carspa-tablero.webp",
        "highlight": {
          "x": 87.1,
          "y": 1.8,
          "w": 12.0,
          "h": 7.0
        },
        "cursor": {
          "x": 93.1,
          "y": 5.3,
          "click": true
        }
      },
      {
        "at": 3,
        "dur": 4,
        "caption": "Escribe la placa; se pone en mayúsculas sola.",
        "image": "/manual/img/carspa-nuevo-servicio.webp",
        "highlight": {
          "x": 26.4,
          "y": 17.1,
          "w": 47.3,
          "h": 7.5
        },
        "cursor": {
          "x": 50.0,
          "y": 20.9,
          "click": false
        },
        "type": {
          "x": 27.9,
          "y": 20.9,
          "text": "P123-456"
        }
      },
      {
        "at": 7,
        "dur": 3,
        "caption": "Elige el tipo de vehículo.",
        "highlight": {
          "x": 31.4,
          "y": 27.3,
          "w": 11.3,
          "h": 7.0
        },
        "cursor": {
          "x": 37.0,
          "y": 30.8,
          "click": true
        }
      },
      {
        "at": 10,
        "dur": 4,
        "caption": "Elige el paquete: el precio sale de tu catálogo.",
        "highlight": {
          "x": 49.5,
          "y": 49.1,
          "w": 24.1,
          "h": 13.8
        },
        "cursor": {
          "x": 61.5,
          "y": 56.0,
          "click": true
        }
      },
      {
        "at": 14,
        "dur": 3,
        "caption": "Si quieres, asigna un empleado desde aquí.",
        "highlight": {
          "x": 26.4,
          "y": 65.5,
          "w": 24.0,
          "h": 7.5
        },
        "cursor": {
          "x": 38.4,
          "y": 69.2,
          "click": false
        }
      },
      {
        "at": 17,
        "dur": 4,
        "caption": "Pulsa «Crear e imprimir ticket».",
        "highlight": {
          "x": 59.0,
          "y": 86.7,
          "w": 14.6,
          "h": 7.5
        },
        "cursor": {
          "x": 66.3,
          "y": 90.5,
          "click": true
        },
        "toast": "Servicio creado"
      }
    ]
  }
};

export default chapter;
