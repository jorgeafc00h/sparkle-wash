import type { ManualChapter } from './types';

const chapter: ManualChapter = {
  "id": "instalacion",
  "order": 100,
  "group": "Car Spa",
  "title": "Instalar Car Spa en Windows",
  "summary": "Descarga el instalador, supera el aviso de SmartScreen y mantén la aplicación al día.",
  "sections": [
    {
      "id": "descargar",
      "title": "Descargar el instalador",
      "body": [
        "El instalador de Windows se llama SparkleWash-Setup-latest.exe. El archivo conserva el nombre anterior de la marca (SparkleWash); la aplicación que instala se llama Car Spa.",
        "Descárgalo siempre desde este enlace: https://github.com/jorgeafc00h/sparkle-wash/releases/latest/download/SparkleWash-Setup-latest.exe. Es la versión más reciente publicada."
      ],
      "steps": [
        "Abre el enlace de descarga en tu navegador y guarda el archivo.",
        "Haz doble clic en SparkleWash-Setup-latest.exe.",
        "Espera a que termine: el instalador no pregunta la carpeta ni pide opciones. Se instala para tu usuario de Windows y crea el acceso directo «Car Spa»."
      ]
    },
    {
      "id": "smartscreen",
      "title": "El aviso de SmartScreen",
      "body": [
        "El instalador todavía no está firmado digitalmente, por eso Windows SmartScreen muestra un aviso la primera vez que lo ejecutas."
      ],
      "steps": [
        "En el aviso «Windows protegió su PC», pulsa «Más información».",
        "Pulsa «Ejecutar de todas formas».",
        "Si tu empresa restringe la instalación de programas, pide ayuda a quien administra tus equipos."
      ],
      "callout": {
        "kind": "warning",
        "title": "Descarga solo desde el enlace oficial",
        "body": "Ejecuta el instalador únicamente si lo descargaste del enlace de arriba. El aviso de Windows aparece porque el archivo no está firmado, no porque Car Spa lo genere."
      }
    },
    {
      "id": "actualizaciones",
      "title": "Actualizaciones",
      "body": [
        "Car Spa busca versiones nuevas por sí sola unos segundos después de abrirse. Si encuentra una, la descarga en segundo plano.",
        "Cuando termina, aparece el mensaje «Actualización disponible» con la versión descargada. Puedes elegir «Reiniciar ahora» o «Más tarde»: si eliges más tarde, se instala al cerrar la aplicación.",
        "Tus datos se conservan al actualizar. Se guardan en la carpeta de datos de tu usuario de Windows, aparte del programa."
      ]
    }
  ],
  "walkthrough": {
    "id": "carspa-instalacion",
    "title": "Instalar Car Spa",
    "image": "/manual/img/carspa-bienvenida.webp",
    "aspect": 1.7786,
    "steps": [
      {
        "at": 0,
        "dur": 4,
        "caption": "Descarga SparkleWash-Setup-latest.exe desde el enlace de la página de descargas.",
        "image": "/manual/img/carspa-bienvenida.webp"
      },
      {
        "at": 4,
        "dur": 4,
        "caption": "Abre el archivo. Si Windows muestra «Windows protegió su PC», elige «Más información»."
      },
      {
        "at": 8,
        "dur": 4,
        "caption": "Después pulsa «Ejecutar de todas formas». El instalador es de un solo paso."
      },
      {
        "at": 12,
        "dur": 5,
        "caption": "Al terminar se abre Car Spa en la pantalla de bienvenida."
      }
    ]
  }
};

export default chapter;
