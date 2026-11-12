import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "fact-compras",
  "order": 209,
  "group": "Facturación electrónica",
  "title": "Compras: registro, importación y verificación",
  "summary": "Registra las compras de la empresa por JSON, a mano o desde el correo, verifícalas con Hacienda y expórtalas.",
  "sections": [
    {
      "id": "lista",
      "title": "Lista de compras",
      "body": [
        "Compras, en la barra lateral, registra los documentos que recibes de tus proveedores. Una franja resume Compras este mes, Total Gravado, Total IVA y Total a Pagar. Debajo puedes buscar por NIT o nombre, filtrar por Fecha desde y Fecha hasta y por Tipo de registro (Todas, Solo DTE o Solo uso interno).",
        "La tabla muestra fecha, emisor, tipo de DTE, total, fuente (manual, correo, OCR…), si está Verificado con Hacienda y si está Vinculada a una factura o cliente. Compras está disponible en todos los planes.",
        "Arriba hay varias acciones: Rango (cuánto tiempo atrás sincronizar), Sincronizar (por IMAP si está configurado, o por Gmail), Conectar y sincronizar Gmail, Importar archivos (imágenes con OCR, PDF o XML), el engranaje de configuración, Verificar compras y Agregar Compra."
      ],
      "figure": {
        "src": "/manual/img/fact-compras-lista.webp",
        "alt": "Lista de compras con resumen del mes, acciones de sincronización e importación y filtros",
        "caption": "Lista de compras con sus acciones de importación."
      }
    },
    {
      "id": "nueva",
      "title": "Agregar una compra",
      "body": [
        "Agregar Compra ofrece tres modos con los botones superiores."
      ],
      "steps": [
        "Importar JSON: carga el archivo JSON del DTE que te envió el proveedor. La app muestra una Vista Previa; revísala e importa. Si ya existía, avisa «Esta compra ya fue importada».",
        "Ingreso Manual: escribe NIT, NRC y nombre del emisor, la Condición de pago, los datos del DTE (tipo, fecha, código de generación, número de control y sello recibido) y las líneas de detalle con descripción, cantidad, precio, venta gravada e IVA. Abajo se calcula el Total a Pagar.",
        "Uso interno: para compras sin DTE válido, por ejemplo en el extranjero. Pide Nombre del proveedor, fecha, referencia del documento y motivo de uso interno. Se guarda solo para control interno y nunca se envía ni se verifica con Hacienda."
      ],
      "figure": {
        "src": "/manual/img/fact-compras-interna.webp",
        "alt": "Formulario de compra de uso interno con aviso de que no se envía a Hacienda",
        "caption": "Modo Uso interno."
      }
    },
    {
      "id": "detalle",
      "title": "Detalle, vinculación y verificación",
      "body": [
        "El detalle de una compra muestra el Emisor, la Información DTE, las Líneas de Detalle y los Totales. En Vinculación puedes relacionar la compra con una factura o con un cliente; así su costo aparece como Costo de materiales en esos detalles. Quitar la vinculación la deja en «Sin vinculación».",
        "Verificar en Consulta Pública compara la compra con lo que Hacienda tiene registrado. El resultado es una etiqueta: Verificado por MH, Invalidado por emisor (con fecha y motivo), No confirmado por MH o Sin verificar. Si los montos no coinciden, aparece la comparación entre el total local y los de Hacienda; las diferencias pueden deberse a retenciones. Verificar compras, en la lista, lo hace con todas."
      ],
      "figure": {
        "src": "/manual/img/fact-compras-detalle.webp",
        "alt": "Detalle de una compra con emisor, información del DTE, líneas y totales",
        "caption": "Detalle de una compra."
      }
    },
    {
      "id": "configuracion",
      "title": "Configuración: importar desde el correo",
      "body": [
        "El engranaje de la lista abre Configuración de Compras. La tarjeta Conectar Gmail (recomendada) importa las facturas que llegan a tu correo usando IMAP: solo lee correos con facturas adjuntas y nunca envía ni borra mensajes."
      ],
      "steps": [
        "Pulsa Empezar configuración.",
        "Paso 1: activa la verificación en 2 pasos en tu cuenta de Google, si todavía no la tienes.",
        "Paso 2: crea una contraseña de aplicación de 16 caracteres en tu cuenta de Google (escribe el nombre de la aplicación cuando te lo pida) y cópiala al verla, porque no se vuelve a mostrar.",
        "Paso 3: escribe tu correo y pega la contraseña de aplicación. Nunca uses la contraseña normal de Gmail. La app detecta el servidor y el puerto; para Outlook, Yahoo o iCloud usa Avanzado y Otro proveedor.",
        "Pulsa Probar conexión y, cuando funcione, Guardar configuración: solo se puede guardar una configuración validada. Después, Sincronizar ahora trae las compras nuevas."
      ],
      "figure": {
        "src": "/manual/img/fact-compras-imap.webp",
        "alt": "Tarjeta Conectar Gmail con los tres pasos para crear la contraseña de aplicación y guardar la conexión",
        "caption": "Conectar Gmail por IMAP en tres pasos."
      },
      "callout": {
        "kind": "info",
        "title": "Otras opciones de la pantalla",
        "body": "Alternativa: Google OAuth permite iniciar sesión con Google en un clic, pero Google muestra una pantalla de «app no verificada» y pide volver a iniciar sesión cada 7 días. La Frecuencia de Sincronización (manual, cada 1, 6 o 12 horas) solo está disponible para empresas en producción; en el plan Free la sincronización de Gmail se limita a una vez cada 24 horas."
      }
    },
    {
      "id": "ocr",
      "title": "Importar archivos con OCR",
      "body": [
        "Importar archivos extrae los datos de imágenes, PDF o XML. Para imágenes y tickets, la tarjeta OCR de facturas (Compras) de la configuración elige el proveedor: Azure OpenAI Vision (en la nube, alta precisión; pide endpoint, nombre del deployment, API key y versión) u Ollama (local, privado, sin enviar datos a la nube). Cada proveedor tiene su botón Guardar y Probar conexión."
      ],
      "figure": {
        "src": "/manual/img/fact-compras-ocr.webp",
        "alt": "Tarjeta OCR de facturas con la elección entre Azure OpenAI Vision y Ollama local",
        "caption": "Proveedor de OCR: Azure OpenAI u Ollama local."
      }
    },
    {
      "id": "exportar",
      "title": "Exportar compras",
      "body": [
        "La pantalla Exportar Compras descarga las compras de un rango de fechas (Fecha desde y Fecha hasta) en CSV o en Excel (.xlsx), o las sube a Google Drive. La opción de incluir compras de uso interno solo aplica al Excel de control general; el CSV nunca las incluye. Si no hay compras en el rango, la app lo avisa."
      ],
      "figure": {
        "src": "/manual/img/fact-compras-exportar.webp",
        "alt": "Pantalla Exportar Compras con filtros de fecha, formato y opción de incluir compras de uso interno",
        "caption": "Exportar compras."
      },
      "callout": {
        "kind": "info",
        "title": "Dónde está esta pantalla",
        "body": "En esta versión, Exportar Compras está registrada con la ruta #/compras/export pero no hay un botón que la abra desde los menús. Los anexos de compras sí salen en Libros IVA."
      }
    }
  ],
  "walkthrough": {
    "id": "fact-compras-walkthrough",
    "title": "Registrar y verificar una compra",
    "image": "/manual/img/fact-compras-lista.webp",
    "aspect": 1.778,
    "steps": [
      {
        "at": 0.5,
        "dur": 3,
        "caption": "En Compras, pulsa Agregar Compra.",
        "highlight": {
          "x": 89.6,
          "y": 3.6,
          "w": 9.1,
          "h": 9.1
        },
        "cursor": {
          "x": 94.1,
          "y": 8.2,
          "click": true
        }
      },
      {
        "at": 3.5,
        "dur": 4,
        "caption": "Elige cómo registrarla: JSON, ingreso manual o uso interno.",
        "image": "/manual/img/fact-compras-interna.webp",
        "highlight": {
          "x": 31.8,
          "y": 28.8,
          "w": 54,
          "h": 9.1
        }
      },
      {
        "at": 7.5,
        "dur": 4,
        "caption": "Abre una compra para ver su emisor, sus líneas y sus totales.",
        "image": "/manual/img/fact-compras-detalle.webp",
        "highlight": {
          "x": 18.9,
          "y": 95.4,
          "w": 79.8,
          "h": 4.6
        }
      },
      {
        "at": 11.5,
        "dur": 3,
        "caption": "Verifica la compra con la Consulta Pública de Hacienda.",
        "highlight": {
          "x": 18.9,
          "y": 95.4,
          "w": 79.8,
          "h": 4.6
        },
        "cursor": {
          "x": 58.8,
          "y": 97.7
        }
      },
      {
        "at": 14.5,
        "dur": 4,
        "caption": "En Configuración conecta tu correo para importar las facturas automáticamente.",
        "image": "/manual/img/fact-compras-imap.webp",
        "highlight": {
          "x": 37.6,
          "y": 50.4,
          "w": 22.3,
          "h": 6.5
        },
        "cursor": {
          "x": 48.8,
          "y": 53.7
        },
        "type": {
          "x": 48.8,
          "y": 53.7,
          "text": "compras@empresa.example"
        }
      },
      {
        "at": 18.5,
        "dur": 3,
        "caption": "Prueba la conexión y guarda.",
        "highlight": {
          "x": 35.3,
          "y": 63.2,
          "w": 6.6,
          "h": 6.5
        },
        "cursor": {
          "x": 38.6,
          "y": 66.5,
          "click": true
        }
      }
    ]
  }
};

export default chapter;
