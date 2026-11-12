import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "fact-catalogos",
  "order": 210,
  "group": "Facturación electrónica",
  "title": "Catálogos y categorías",
  "summary": "Consulta los catálogos oficiales del Ministerio de Hacienda que usa la app y organiza tus productos con categorías propias.",
  "sections": [
    {
      "id": "catalogos",
      "title": "Catálogos del Ministerio de Hacienda",
      "body": [
        "Catálogos, en la barra lateral, muestra los catálogos oficiales que usan los DTE: ambiente, tipo de documento o evento, tipo de contingencia, departamentos, municipios, unidades de medida, tributos, actividades económicas y más. Cada tarjeta indica el código (por ejemplo CAT-012), el nombre, si está Activo o Inactivo y cuántas opciones tiene.",
        "Busca por código, nombre u opción dentro del catálogo. Sincronizar Catálogos descarga la versión más reciente; al terminar aparece «Catálogos sincronizados correctamente», y si falla, «Error al sincronizar los catálogos. Verifica tu conexión.». Arriba se muestra la fecha de la última sincronización.",
        "Los desplegables de la app (ubicación, actividad económica, tipo de establecimiento, tipo de contingencia) se alimentan de estos catálogos."
      ],
      "figure": {
        "src": "/manual/img/fact-catalogos-lista.webp",
        "alt": "Lista de catálogos del Ministerio de Hacienda con buscador y botón Sincronizar Catálogos",
        "caption": "Catálogos del Ministerio de Hacienda."
      }
    },
    {
      "id": "detalle",
      "title": "Ver las opciones de un catálogo",
      "body": [
        "Tocar una tarjeta abre el detalle del catálogo: su nombre, el número de opciones y la versión, y una tabla con el Código y la Descripción de cada opción (y el Departamento en los catálogos que lo traen, como municipios). El cuadro Filtrar por código o descripción reduce la tabla. Volver regresa a la lista."
      ],
      "figure": {
        "src": "/manual/img/fact-catalogos-detalle.webp",
        "alt": "Detalle del catálogo Departamento con tabla de códigos y descripciones y filtro",
        "caption": "Opciones del catálogo Departamento (CAT-012)."
      }
    },
    {
      "id": "categorias",
      "title": "Categorías de productos",
      "body": [
        "Categorías de Productos (Configuración, tarjeta Categorías de Productos) administra la lista que aparece en el formulario de producto y en el filtro de la lista de productos. Cada fila muestra cuántos productos usan la categoría."
      ],
      "steps": [
        "Escribe el nombre de la categoría y pulsa Agregar. Si ya existe, la app avisa «La categoría … ya existe».",
        "Con el lápiz de una fila la renombras; los productos de esa categoría se actualizan en todos tus dispositivos.",
        "Con la papelera la eliminas, solo si ningún producto la usa; en caso contrario, la app indica cuántos productos la usan."
      ],
      "figure": {
        "src": "/manual/img/fact-catalogos-categorias.webp",
        "alt": "Pantalla Categorías de Productos con campo para agregar y lista con conteo de productos",
        "caption": "Categorías con el número de productos que las usan."
      },
      "callout": {
        "kind": "info",
        "title": "También desde el producto",
        "body": "En el formulario de producto, la opción «+ Nueva categoría…» crea una categoría al guardar; después aparece en esta lista."
      }
    }
  ],
  "walkthrough": {
    "id": "fact-catalogos-walkthrough",
    "title": "Consultar un catálogo y crear una categoría",
    "image": "/manual/img/fact-catalogos-lista.webp",
    "aspect": 1.778,
    "steps": [
      {
        "at": 0.5,
        "dur": 3,
        "caption": "Busca un catálogo por código, nombre u opción.",
        "highlight": {
          "x": 18.9,
          "y": 14.3,
          "w": 79.8,
          "h": 6.5
        },
        "cursor": {
          "x": 58.8,
          "y": 17.6,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 3,
        "caption": "Sincronizar Catálogos trae la versión más reciente de Hacienda.",
        "highlight": {
          "x": 83,
          "y": 2.3,
          "w": 15.7,
          "h": 6.5
        },
        "cursor": {
          "x": 90.9,
          "y": 5.6
        }
      },
      {
        "at": 6.5,
        "dur": 3,
        "caption": "Toca un catálogo para ver sus opciones.",
        "highlight": {
          "x": 72.3,
          "y": 66.1,
          "w": 26.4,
          "h": 13.8
        },
        "cursor": {
          "x": 85.5,
          "y": 73,
          "click": true
        }
      },
      {
        "at": 9.5,
        "dur": 4,
        "caption": "Filtra por código o descripción.",
        "image": "/manual/img/fact-catalogos-detalle.webp",
        "highlight": {
          "x": 17.1,
          "y": 12.8,
          "w": 82.9,
          "h": 9.8
        },
        "cursor": {
          "x": 58.6,
          "y": 17.7
        },
        "type": {
          "x": 58.6,
          "y": 17.7,
          "text": "Santa Ana"
        }
      },
      {
        "at": 13.5,
        "dur": 4,
        "caption": "En Categorías de Productos, escribe un nombre nuevo.",
        "image": "/manual/img/fact-catalogos-categorias.webp",
        "highlight": {
          "x": 20.4,
          "y": 15.5,
          "w": 45.3,
          "h": 6.5
        },
        "cursor": {
          "x": 43.1,
          "y": 18.8
        },
        "type": {
          "x": 43.1,
          "y": 18.8,
          "text": "Accesorios"
        }
      },
      {
        "at": 17.5,
        "dur": 3,
        "caption": "Pulsa Agregar: ya puedes usarla en tus productos.",
        "highlight": {
          "x": 65.5,
          "y": 15.5,
          "w": 9,
          "h": 6.5
        },
        "cursor": {
          "x": 70,
          "y": 18.8,
          "click": true
        },
        "toast": "Categoría agregada."
      }
    ]
  }
};

export default chapter;
