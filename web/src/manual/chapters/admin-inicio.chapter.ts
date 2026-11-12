import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "admin-inicio",
  "order": 401,
  "group": "Administración",
  "title": "Inicio y cobros y pagos",
  "summary": "El tablero con el resumen de tu actividad y el seguimiento local de cuentas por cobrar y por pagar.",
  "sections": [
    {
      "id": "tablero",
      "title": "El tablero de Inicio",
      "body": [
        "Inicio (ruta /home) resume la empresa activa. Arriba a la derecha ves el ambiente de la empresa (por ejemplo «Desarrollo») y tu cuenta de Google; si no has iniciado sesión aparece el botón «Iniciar sesión con Google», y junto a tu cuenta hay un icono para cerrar sesión.",
        "Las tarjetas muestran Total Facturas, Total Compras, Ingresos del Mes, Pendientes de Sincronizar, Por Cobrar y Facturas Este Mes con su total. Más abajo está Acciones Rápidas (Nueva Factura, Clientes, Productos, Compras, Cobros y pagos, Libros IVA, Empresas) y la lista de Últimas Facturas. En el plan gratuito se agrega una tarjeta «Suscríbete a Pro».",
        "Si usas el punto de venta, aparece la tarjeta «Ventas POS hoy» con el total del día y los tickets, y un resumen «Sin facturar este mes» con el botón Consolidar que lleva al capítulo de consolidación."
      ],
      "figure": {
        "src": "/manual/img/admin-inicio.webp",
        "alt": "Inicio con tarjetas de resumen, ventas POS de hoy y acciones rápidas",
        "caption": "Inicio con datos de ejemplo."
      },
      "callout": {
        "kind": "info",
        "title": "Pendientes de Sincronizar",
        "body": "Cuenta los documentos que todavía no se enviaron a Hacienda. No es la sincronización entre dispositivos (esa está en Configuración → Sincronización)."
      }
    },
    {
      "id": "cobros-pagos",
      "title": "Cobros y pagos",
      "body": [
        "Cobros y pagos (ruta /accounts, menú Finanzas) es un seguimiento local de saldos. Las cuatro tarjetas de arriba muestran lo Por cobrar, los Cobros vencidos, lo Por pagar y los Pagos vencidos. Abajo, el selector «Por cobrar / Por pagar» cambia de lista; puedes buscar por cliente, proveedor, NIT o documento y filtrar por estado (Al día, Vencidas, Parciales, Pagadas).",
        "Las cuentas salen de los documentos: facturas y compras con condición de pago a crédito (o con plazo). Pulsa Actualizar para que la app revise tus documentos y cree o ponga al día las cuentas."
      ],
      "steps": [
        "Pulsa Actualizar para traer las cuentas desde tus facturas y compras.",
        "Haz clic en una fila para abrir «Registrar cobro» (o «Registrar pago» en las cuentas por pagar).",
        "Completa Fecha, Monto, Método y Referencia y guarda. El saldo, la antigüedad y el estado se recalculan."
      ],
      "figure": {
        "src": "/manual/img/admin-cobros-pagos.webp",
        "alt": "Pantalla Cobros y pagos con resumen, selector Por cobrar y Por pagar, búsqueda y filtro",
        "caption": "Cobros y pagos sin cuentas abiertas todavía."
      },
      "callout": {
        "kind": "info",
        "title": "Registro local primero",
        "body": "La propia pantalla lo dice: los cobros y pagos actualizan el saldo de la cuenta sin cambiar los totales fiscales del DTE o de la compra. Es un control interno, no un movimiento ante Hacienda."
      }
    }
  ],
  "walkthrough": {
    "id": "admin-inicio",
    "title": "Recorrer Inicio y Cobros y pagos",
    "image": "/manual/img/admin-inicio.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 3.5,
        "caption": "Tu cuenta y el ambiente de la empresa aparecen arriba a la derecha.",
        "highlight": {
          "x": 82.2,
          "y": 2.3,
          "w": 16.5,
          "h": 7.1
        },
        "cursor": {
          "x": 90.5,
          "y": 5.9
        }
      },
      {
        "at": 3.5,
        "dur": 4,
        "caption": "Las tarjetas resumen facturas, compras, ingresos y cuentas por cobrar.",
        "highlight": {
          "x": 18.9,
          "y": 12.8,
          "w": 79.8,
          "h": 29.7
        },
        "cursor": {
          "x": 58.8,
          "y": 27.7
        }
      },
      {
        "at": 7.5,
        "dur": 3.5,
        "caption": "En Cobros y pagos, cambia entre lo Por cobrar y lo Por pagar.",
        "image": "/manual/img/admin-cobros-pagos.webp",
        "highlight": {
          "x": 83,
          "y": 31.1,
          "w": 7.5,
          "h": 5.7
        },
        "cursor": {
          "x": 86.8,
          "y": 34,
          "click": true
        }
      },
      {
        "at": 11,
        "dur": 3.5,
        "caption": "Busca por cliente, proveedor, NIT o documento.",
        "highlight": {
          "x": 20.4,
          "y": 40.4,
          "w": 62.7,
          "h": 6.5
        },
        "cursor": {
          "x": 51.8,
          "y": 43.7,
          "click": true
        }
      },
      {
        "at": 14.5,
        "dur": 3.5,
        "caption": "Filtra por estado.",
        "highlight": {
          "x": 83.1,
          "y": 40.4,
          "w": 14.1,
          "h": 6.5
        },
        "cursor": {
          "x": 90.1,
          "y": 43.7,
          "click": true
        }
      },
      {
        "at": 18,
        "dur": 3.5,
        "caption": "Pulsa Actualizar para traer las cuentas de tus documentos.",
        "highlight": {
          "x": 88.8,
          "y": 2.3,
          "w": 9.9,
          "h": 6.5
        },
        "cursor": {
          "x": 93.8,
          "y": 5.6,
          "click": true
        }
      }
    ]
  }
};

export default chapter;
