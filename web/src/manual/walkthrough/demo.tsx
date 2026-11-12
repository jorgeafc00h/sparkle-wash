// Dev-only demo for the walkthrough engine (see demo.html). Coordinates were measured on
// /landing/screens/tablero.jpg (2560×1280) and en-vivo.jpg (2560×1600, shown top-aligned).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../design/tokens.css';
import { WalkthroughPlayer, type Walkthrough } from '.';

const demo: Walkthrough = {
  id: 'demo-tablero',
  title: 'Tablero de trabajos',
  image: '/landing/screens/tablero.jpg',
  aspect: 2,
  steps: [
    {
      at: 0, dur: 3.5,
      caption: 'El tablero agrupa los carros por etapa: Llegó, En cola, Lavando y Listo.',
      highlight: { x: 21.9, y: 17.8, w: 75.6, h: 57.7 },
    },
    {
      at: 3.5, dur: 3.5,
      caption: 'Abra «Trabajos» en el menú lateral para ver el tablero.',
      highlight: { x: 1.1, y: 30, w: 17.05, h: 6.8 },
      cursor: { x: 9.5, y: 33.6, click: true },
    },
    {
      at: 7, dur: 4.5,
      caption: 'Toque «Asignar» y escriba quién lava el carro TX4410.',
      highlight: { x: 31.2, y: 42.3, w: 6.8, h: 5 },
      cursor: { x: 34.6, y: 44.8, click: true },
      type: { x: 24.05, y: 44.7, text: 'Luis H.' },
      zoom: { x: 22.95, y: 25.5, w: 16.6, h: 31.5 },
    },
    {
      at: 11.5, dur: 3.5,
      caption: 'Pulse «A la cola» para pasarlo a la fila de lavado.',
      highlight: { x: 23.75, y: 48.6, w: 8.7, h: 6.5 },
      cursor: { x: 28.1, y: 51.9, click: true },
      toast: 'Carro en cola',
    },
    {
      at: 15, dur: 3.5,
      caption: 'Cuando termine el lavado, pulse «Marcar listo».',
      highlight: { x: 63.45, y: 48.6, w: 10.4, h: 6.5 },
      cursor: { x: 68.6, y: 51.9, click: true },
      toast: 'Listo para entregar',
    },
    {
      at: 18.5, dur: 4.5,
      caption: 'En vivo resume el día: por revisar, en el lugar y listos hoy.',
      image: '/landing/screens/en-vivo.jpg',
      highlight: { x: 21.9, y: 17.8, w: 75.6, h: 18.3 },
      cursor: { x: 90, y: 10.6 },
    },
  ],
};

const autoPlay = new URLSearchParams(location.search).get('autoplay') !== '0';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main className="demo">
      <h1>Recorrido animado</h1>
      <p>Demo del motor: capturas reales con anillos, puntero, texto escrito, avisos y zoom en CSS.</p>
      <WalkthroughPlayer data={demo} lang="es" autoPlay={autoPlay} />
    </main>
  </StrictMode>,
);
