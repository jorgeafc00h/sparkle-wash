import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "fact-clientes",
  "order": 207,
  "group": "Facturación electrónica",
  "title": "Clientes",
  "summary": "Registra a las personas y empresas a las que facturas, con sus documentos fiscales y las marcas de retención y gran contribuyente.",
  "sections": [
    {
      "id": "lista",
      "title": "Lista de clientes",
      "body": [
        "Clientes, en la barra lateral, muestra los clientes de la empresa activa con su nombre, NIT o DUI, tipo (Individual, Empresa o Gobierno), teléfono, correo y estado (Activo o Inactivo). Busca por nombre, NIT o DUI con el cuadro superior. Tocar una fila abre el detalle; Agregar Cliente abre el formulario.",
        "Cuando no hay clientes aparece «No hay clientes» con el botón Agregar Cliente. Los clientes que registras aquí son los que aparecen en el buscador al crear un DTE."
      ],
      "figure": {
        "src": "/manual/img/fact-clientes-lista.webp",
        "alt": "Lista de clientes con buscador por nombre, NIT o DUI y botón Agregar Cliente",
        "caption": "Lista de clientes."
      }
    },
    {
      "id": "formulario",
      "title": "Crear o editar un cliente",
      "body": [
        "El formulario se divide en bloques. Los campos marcados con asterisco son obligatorios."
      ],
      "steps": [
        "Información Personal: Nombre y Apellido, el Tipo de Cliente (Individual, Empresa o Gobierno) y, para empresas, la Razón Social.",
        "Identificación: el Tipo de Documento (DUI, NIT, Pasaporte, Carnet Residente u Otro) y su número. El DUI usa el formato 01234567-8 y el NIT, 0614-123456-789-0; si el formato es incorrecto, el formulario lo avisa. El NRC es el número de registro de contribuyente.",
        "Contacto: Email, Teléfono, Dirección y los desplegables de departamento, municipio y distrito.",
        "Marca «Tiene retención de contribuyente» si el cliente te retiene IVA, y «Gran contribuyente» si es gran contribuyente.",
        "Información de Exportación (opcional): Código de País, por ejemplo SLV, Nombre de País y Tipo de Persona (Natural o Jurídica). Es necesaria para facturas de exportación.",
        "Pulsa el botón de guardar. La app confirma con «Cliente creado correctamente» o «Cliente actualizado correctamente»."
      ],
      "figure": {
        "src": "/manual/img/fact-clientes-form.webp",
        "alt": "Formulario de edición de un cliente tipo Empresa con identificación, NIT y NRC",
        "caption": "Formulario de cliente: datos personales, identificación y contacto."
      }
    },
    {
      "id": "marcas",
      "title": "Retención y gran contribuyente",
      "body": [
        "Las dos casillas cambian los totales de los documentos. Con «Tiene retención de contribuyente», una Factura o un CCF por 100 dólares o más (sin IVA) resta la retención de IVA de 1 % del total a pagar. Con «Gran contribuyente» no se cobra la percepción de IVA de 1 % aunque la empresa sea agente de percepción."
      ],
      "figure": {
        "src": "/manual/img/fact-clientes-retencion.webp",
        "alt": "Casillas Tiene retención de contribuyente y Gran contribuyente del formulario de cliente",
        "caption": "Casillas de retención y gran contribuyente."
      }
    },
    {
      "id": "detalle",
      "title": "Detalle, edición y eliminación",
      "body": [
        "El detalle reúne los datos de identificación y de contacto, las etiquetas de estado (Activo, Inactivo, Retención) y, si hay compras vinculadas al cliente, la suma del costo de materiales. Desde aquí puedes pulsar Editar o Eliminar; eliminar pide confirmar y no se puede deshacer."
      ],
      "figure": {
        "src": "/manual/img/fact-clientes-detalle.webp",
        "alt": "Detalle de un cliente con botones Editar y Eliminar",
        "caption": "Detalle de un cliente."
      }
    }
  ],
  "walkthrough": {
    "id": "fact-clientes-walkthrough",
    "title": "Registrar un cliente con retención",
    "image": "/manual/img/fact-clientes-lista.webp",
    "aspect": 1.778,
    "steps": [
      {
        "at": 0.5,
        "dur": 3,
        "caption": "En Clientes, pulsa Agregar Cliente.",
        "highlight": {
          "x": 87.8,
          "y": 2.3,
          "w": 10.9,
          "h": 6.5
        },
        "cursor": {
          "x": 93.3,
          "y": 5.6,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 3,
        "caption": "Elige el tipo de cliente: Individual, Empresa o Gobierno.",
        "image": "/manual/img/fact-clientes-form.webp",
        "highlight": {
          "x": 20.4,
          "y": 33.5,
          "w": 38.2,
          "h": 6.5
        },
        "cursor": {
          "x": 39.5,
          "y": 36.8,
          "click": true
        }
      },
      {
        "at": 6.5,
        "dur": 4,
        "caption": "Escribe el NIT con el formato 0000-000000-000-0 y el NRC.",
        "highlight": {
          "x": 20.4,
          "y": 63.9,
          "w": 38.2,
          "h": 6.5
        },
        "cursor": {
          "x": 39.5,
          "y": 67.2
        },
        "type": {
          "x": 39.5,
          "y": 67.2,
          "text": "0614-020203-101-1"
        }
      },
      {
        "at": 10.5,
        "dur": 4,
        "caption": "Marca la retención si el cliente retiene IVA.",
        "image": "/manual/img/fact-clientes-retencion.webp",
        "highlight": {
          "x": 20.4,
          "y": 54.6,
          "w": 76.7,
          "h": 4.2
        },
        "cursor": {
          "x": 58.8,
          "y": 56.7,
          "click": true
        }
      },
      {
        "at": 14.5,
        "dur": 3,
        "caption": "Guarda: el cliente ya aparece al crear un documento.",
        "highlight": {
          "x": 86.9,
          "y": 91.1,
          "w": 11.8,
          "h": 6.5
        },
        "cursor": {
          "x": 92.8,
          "y": 94.4,
          "click": true
        },
        "toast": "Cliente creado correctamente."
      }
    ]
  }
};

export default chapter;
