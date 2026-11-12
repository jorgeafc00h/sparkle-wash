import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "admin-cuenta",
  "order": 402,
  "group": "Administración",
  "title": "Perfil, cuenta y plan",
  "summary": "Tu perfil, el plan Free, Pro o Business, qué desbloquea cada uno, cómo cambiar de plan y de tarjeta.",
  "sections": [
    {
      "id": "perfil",
      "title": "Perfil",
      "body": [
        "Perfil (ruta /settings/profile) muestra si estás Autenticado o en Modo Invitado. Con sesión ves tu nombre, correo y teléfono, y la lista «Proveedores vinculados», donde «Vincular» agrega Google a tu cuenta actual. En modo invitado solo aparece el estado y el botón «Cerrar Sesión».",
        "Cerrar Sesión sale de tu cuenta de Google en esta computadora. Si se detecta que el correo ya existe con otro método de inicio, la pantalla avisa «Vinculación de cuenta requerida»."
      ],
      "figure": {
        "src": "/manual/img/admin-perfil.webp",
        "alt": "Perfil con cuenta autenticada, detalles de la cuenta y proveedores vinculados",
        "caption": "Perfil de una cuenta con sesión (datos de ejemplo)."
      }
    },
    {
      "id": "resumen",
      "title": "Resumen de cuenta",
      "body": [
        "Configuración → Cuenta (ruta /settings/account) es el Resumen de Cuenta: el Plan Actual, la lista de lo que incluye y el Uso Actual (Empresas usadas del máximo, Documentos emitidos y Compras registradas)."
      ],
      "steps": [
        "Pulsa «Cambiar Plan» para ver los planes disponibles.",
        "«Actualizar tarjeta» y «Cancelar suscripción» aparecen solo si tu plan se pagó con tarjeta (N1CO). Una prueba gratis o un plan concedido no los muestran.",
        "Si el último cobro fue rechazado aparece el aviso «Pago pendiente» con el botón «Actualizar tarjeta»."
      ],
      "figure": {
        "src": "/manual/img/admin-cuenta-pro.webp",
        "alt": "Resumen de cuenta del plan Pro con Cambiar Plan, Actualizar tarjeta y Cancelar suscripción",
        "caption": "Plan Pro con suscripción por tarjeta."
      }
    },
    {
      "id": "planes",
      "title": "Qué desbloquea cada plan",
      "body": [
        "Todos los planes: todos los tipos de DTE, firma local, exportación a Excel, compras, el punto de venta con sus tickets, devoluciones y cierres, y el chat de ayuda.",
        "Free (Gratis): 1 empresa y un anuncio breve antes de sincronizar en el escritorio. No incluye Libros IVA, respaldo en Google Drive, envío por correo, exportación PDF por lotes ni consolidación de tickets.",
        "Pro: hasta 2 empresas, Libros IVA, respaldo en Google Drive, envío por correo, exportación PDF por lotes, consolidación de tickets del POS y sin anuncios.",
        "Business: todo lo de Pro, con empresas ilimitadas y soporte prioritario.",
        "Pro+Sync: todo lo de Business y sincronización entre dispositivos (teléfono y computadora). Enterprise: lo anterior y respaldos en el servidor.",
        "Desde las pantallas bloqueadas puedes pulsar «Iniciar prueba gratis de 2 meses» (sin tarjeta, 60 días con las funciones de pago, según se muestra en pantalla) o «Ver planes»."
      ],
      "figure": {
        "src": "/manual/img/admin-cuenta-free.webp",
        "alt": "Resumen de cuenta del plan Free con 1 empresa máximo",
        "caption": "El plan Free: 1 empresa y sus límites."
      },
      "callout": {
        "kind": "info",
        "title": "Los precios los muestra la app",
        "body": "Este manual no fija precios: el precio vigente de cada plan aparece en la pantalla de planes, junto a «Pagar con tarjeta»."
      }
    },
    {
      "id": "promo",
      "title": "Cambiar de plan y códigos de descuento",
      "body": [
        "«Cambiar Plan» o «Mejorar plan» abre «Planes y Códigos Promocionales» (ruta /settings/promo): tu plan actual, los planes disponibles, el pago con tarjeta y, más abajo, un campo de código de descuento. Los pagos los procesa N1CO; la propia pantalla indica que los datos de la tarjeta no se almacenan en este dispositivo."
      ],
      "figure": {
        "src": "/manual/img/admin-planes.webp",
        "alt": "Planes y códigos promocionales con plan actual y planes disponibles",
        "caption": "Pantalla de planes."
      }
    },
    {
      "id": "tarjeta",
      "title": "Actualizar la tarjeta",
      "body": [
        "«Actualizar tarjeta» (ruta /settings/account/change-card) pide el nombre del titular, el número de tarjeta, mes, año y CVV, y se guarda con «Guardar nueva tarjeta». Requiere haber iniciado sesión con Google. Los datos se envían a N1CO; no se conservan en la app."
      ],
      "figure": {
        "src": "/manual/img/admin-cambiar-tarjeta.webp",
        "alt": "Formulario Actualizar Tarjeta con nombre del titular, número, mes, año y CVV",
        "caption": "Formulario para cambiar la tarjeta (sin datos reales)."
      },
      "callout": {
        "kind": "warning",
        "title": "No compartas tarjetas en capturas",
        "body": "Al documentar o pedir soporte, nunca pegues el número completo de una tarjeta ni el CVV."
      }
    }
  ],
  "walkthrough": {
    "id": "admin-cuenta",
    "title": "Revisar tu plan y cambiar la tarjeta",
    "image": "/manual/img/admin-perfil.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3.5,
        "caption": "En Perfil ves tu cuenta y los proveedores vinculados.",
        "highlight": {
          "x": 39.6,
          "y": 53.4,
          "w": 38.4,
          "h": 24
        },
        "cursor": {
          "x": 58.8,
          "y": 65.4
        }
      },
      {
        "at": 3.5,
        "dur": 3.5,
        "caption": "En Cuenta se muestra el plan actual y lo que incluye.",
        "image": "/manual/img/admin-cuenta-pro.webp",
        "highlight": {
          "x": 39.6,
          "y": 2.3,
          "w": 38.4,
          "h": 94.8
        },
        "cursor": {
          "x": 58.8,
          "y": 49.7
        }
      },
      {
        "at": 7,
        "dur": 3.5,
        "caption": "Actualiza la tarjeta si el cobro fue rechazado.",
        "highlight": {
          "x": 41.1,
          "y": 57.2,
          "w": 35.3,
          "h": 6.5
        },
        "cursor": {
          "x": 58.8,
          "y": 60.5,
          "click": true
        }
      },
      {
        "at": 10.5,
        "dur": 3.5,
        "caption": "Compara planes y aplica un código de descuento.",
        "image": "/manual/img/admin-planes.webp"
      },
      {
        "at": 14,
        "dur": 4,
        "caption": "Escribe los datos de la nueva tarjeta; la app no la conserva.",
        "image": "/manual/img/admin-cambiar-tarjeta.webp",
        "highlight": {
          "x": 39.6,
          "y": 2.3,
          "w": 38.4,
          "h": 79.2
        },
        "cursor": {
          "x": 58.8,
          "y": 41.9
        }
      }
    ]
  }
};

export default chapter;
