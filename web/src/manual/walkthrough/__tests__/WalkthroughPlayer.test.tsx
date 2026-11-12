import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WalkthroughPlayer, type Walkthrough } from '..';

const data: Walkthrough = {
  id: 'demo',
  title: 'Tablero de trabajos',
  image: '/img/a.webp',
  aspect: 1366 / 768,
  steps: [
    { at: 0, dur: 3, caption: 'El tablero agrupa los carros por etapa.', highlight: { x: 20, y: 15, w: 70, h: 40 } },
    { at: 3, dur: 3, caption: 'Abra Trabajos en el menú.', cursor: { x: 9, y: 33, click: true }, highlight: { x: 1, y: 30, w: 17, h: 7 } },
    { at: 6, dur: 4, caption: 'Escriba la placa del carro.', type: { x: 40, y: 22.5, text: 'P118450' }, zoom: { x: 30, y: 10, w: 40, h: 30 } },
    { at: 10, dur: 3, caption: 'Pulse Guardar.', image: '/img/b.webp', toast: 'Servicio creado', cursor: { x: 80, y: 90, click: true } },
    { at: 13, dur: 3, caption: 'El carro aparece en la cola.' },
  ],
};

// IntersectionObserver and matchMedia do not exist in jsdom: install controllable fakes.
let ioCallback: IntersectionObserverCallback | undefined;
function installIO() {
  ioCallback = undefined;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: IntersectionObserverCallback) { ioCallback = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  });
}
function setVisible(visible: boolean) {
  act(() => {
    ioCallback?.([{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
}
function setReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const root = (c: HTMLElement) => c.querySelector('.cs-w') as HTMLElement;
const caption = () => document.querySelector('.cs-w-cap') as HTMLElement;
const stepButton = (n: number) => within(screen.getByRole('list', { name: 'Pasos del recorrido' })).getAllByRole('button')[n - 1];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'Date'] });
  installIO();
  setReducedMotion(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WalkthroughPlayer', () => {
  it('lists every caption, in order, under the player', () => {
    render(<WalkthroughPlayer data={data} lang="es" />);
    const list = screen.getByRole('list', { name: 'Pasos del recorrido' });
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(data.steps.length);
    items.forEach((li, k) => expect(li).toHaveTextContent(data.steps[k].caption));
    // every control is a real button (keyboard reachable)
    for (const name of ['Paso anterior', 'Reproducir', 'Paso siguiente', 'Reiniciar']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('jumping to a step shows its caption and highlight', () => {
    const { container } = render(<WalkthroughPlayer data={data} lang="es" />);
    fireEvent.click(stepButton(2));
    expect(caption()).toHaveTextContent('Abra Trabajos en el menú.');
    expect(caption()).toHaveAttribute('aria-live', 'polite');
    expect(stepButton(2)).toHaveAttribute('aria-current', 'step');
    expect(stepButton(1)).not.toHaveAttribute('aria-current');
    const ring = container.querySelector('.cs-w-ring') as HTMLElement;
    expect(ring.style.left).toBe('1%');
    expect(ring.style.top).toBe('30%');
    expect(ring.style.width).toBe('17%');
    expect(ring.style.height).toBe('7%');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Paso 2 de 5');
    // a jump while paused shows the static, settled frame
    expect(root(container)).toHaveClass('cs-w-static');

    fireEvent.click(screen.getByRole('button', { name: 'Paso siguiente' }));
    expect(caption()).toHaveTextContent('Escriba la placa del carro.');
    expect(container.querySelector('.cs-w-typed')).toHaveTextContent('P118450');
    expect(container.querySelector('.cs-w-ring')).toBeNull();
  });

  it('auto-plays once visible, advances on the clock and honours pause', () => {
    const { container } = render(<WalkthroughPlayer data={data} lang="es" />);
    expect(root(container)).toHaveAttribute('data-playing', 'false');
    setVisible(true);
    expect(root(container)).toHaveAttribute('data-playing', 'true');
    expect(root(container)).toHaveClass('cs-w-live');
    expect(root(container)).not.toHaveClass('cs-w-paused');

    advance(3200); // step 1 lasts 3 s
    expect(root(container)).toHaveAttribute('data-step', '2');
    expect(caption()).toHaveTextContent('Abra Trabajos en el menú.');

    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    expect(root(container)).toHaveAttribute('data-playing', 'false');
    expect(root(container)).toHaveClass('cs-w-paused');
    advance(20_000);
    expect(root(container)).toHaveAttribute('data-step', '2');
    expect(caption()).toHaveTextContent('Abra Trabajos en el menú.');

    // resuming continues mid-step (2.8 s left of step 2 after 0.2 s elapsed)
    fireEvent.click(screen.getByRole('button', { name: 'Reproducir' }));
    advance(2600);
    expect(root(container)).toHaveAttribute('data-step', '2');
    advance(400);
    expect(root(container)).toHaveAttribute('data-step', '3');
  });

  it('pauses offscreen and resumes when visible again', () => {
    const { container } = render(<WalkthroughPlayer data={data} lang="es" />);
    setVisible(true);
    advance(1000);
    setVisible(false);
    expect(root(container)).toHaveAttribute('data-playing', 'false');
    advance(10_000);
    expect(root(container)).toHaveAttribute('data-step', '1');
    setVisible(true);
    expect(root(container)).toHaveAttribute('data-playing', 'true');
  });

  it('stops on the last step and offers to play again', () => {
    const { container } = render(<WalkthroughPlayer data={data} lang="es" />);
    setVisible(true);
    advance(17_000);
    expect(root(container)).toHaveAttribute('data-step', '5');
    expect(root(container)).toHaveAttribute('data-playing', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Ver de nuevo' }));
    expect(root(container)).toHaveAttribute('data-step', '1');
    expect(root(container)).toHaveAttribute('data-playing', 'true');
  });

  it('does not auto-play under reduced motion and steps through static frames', () => {
    setReducedMotion(true);
    const { container } = render(<WalkthroughPlayer data={data} lang="es" />);
    setVisible(true);
    advance(10_000);
    expect(root(container)).toHaveAttribute('data-playing', 'false');
    expect(root(container)).toHaveAttribute('data-step', '1');
    expect(root(container)).toHaveClass('cs-w-static');
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeInTheDocument();
    // static frame: screenshot + highlight + caption
    expect(container.querySelector('.cs-w-ring')).not.toBeNull();
    expect(caption()).toHaveTextContent(data.steps[0].caption);

    fireEvent.click(screen.getByRole('button', { name: 'Paso siguiente' }));
    expect(root(container)).toHaveAttribute('data-step', '2');
    expect(root(container)).toHaveClass('cs-w-static');
    fireEvent.click(screen.getByRole('button', { name: 'Paso anterior' }));
    expect(root(container)).toHaveAttribute('data-step', '1');
    expect(screen.getByRole('button', { name: 'Paso anterior' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('swaps the screenshot src when a step changes the image', () => {
    const { container } = render(<WalkthroughPlayer data={data} lang="es" />);
    const current = () => container.querySelector('.cs-w-img--current') as HTMLImageElement;
    expect(current().getAttribute('src')).toBe('/img/a.webp');
    fireEvent.click(stepButton(4));
    expect(current().getAttribute('src')).toBe('/img/b.webp');
    expect(container.querySelector('.cs-w-toast')).toHaveTextContent('Servicio creado');
    fireEvent.click(stepButton(5)); // no image key: the new screenshot stays
    expect(current().getAttribute('src')).toBe('/img/b.webp');
    fireEvent.click(stepButton(1));
    expect(current().getAttribute('src')).toBe('/img/a.webp');
  });

  it('crossfades from the previous screenshot while playing', () => {
    const { container } = render(<WalkthroughPlayer data={data} lang="es" />);
    setVisible(true);
    fireEvent.click(stepButton(4));
    const imgs = [...container.querySelectorAll('.cs-w-img')].map((i) => i.getAttribute('src'));
    expect(imgs).toEqual(['/img/a.webp', '/img/b.webp']);
    expect(container.querySelector('.cs-w-img--current')).toHaveClass('cs-w-img--in');
  });

  it('positions every overlay in percent of the screenshot', () => {
    const { container } = render(<WalkthroughPlayer data={data} lang="es" />);
    fireEvent.click(stepButton(3));
    const typed = container.querySelector('.cs-w-typed') as HTMLElement;
    expect(typed.style.left).toBe('40%');
    expect(typed.style.top).toBe('22.5%');
    // the cursor carried from step 2 sits on the same percent coordinates
    const cursor = container.querySelector('.cs-w-cursor') as HTMLElement;
    expect(cursor.style.getPropertyValue('--tx')).toBe('9%');
    expect(cursor.style.getPropertyValue('--ty')).toBe('33%');
    // zoom camera is expressed in percent too
    expect(root(container).style.getPropertyValue('--zx1')).toMatch(/%$/);

    fireEvent.click(stepButton(2));
    const ring = container.querySelector('.cs-w-ring') as HTMLElement;
    for (const v of [ring.style.left, ring.style.top, ring.style.width, ring.style.height]) expect(v).toMatch(/^[\d.]+%$/);
    fireEvent.click(stepButton(4));
    const moved = container.querySelector('.cs-w-cursor') as HTMLElement;
    expect(moved.style.getPropertyValue('--fx')).toBe('9%'); // travels from the previous pointer position
    expect(moved.style.getPropertyValue('--tx')).toBe('80%');
    expect(moved.querySelector('.cs-w-ripple')).not.toBeNull();
  });

  it('uses English control labels when asked', () => {
    render(<WalkthroughPlayer data={data} lang="en" />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Walkthrough steps' })).toBeInTheDocument();
  });
});
