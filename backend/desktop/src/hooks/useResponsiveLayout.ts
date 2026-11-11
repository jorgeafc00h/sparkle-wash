/**
 * useResponsiveLayout — Hook para detección de tamaño de pantalla
 *
 * Escucha los cambios de tamaño de ventana y clasifica el layout en
 * tres categorías: móvil, tablet y escritorio.
 *
 * Breakpoints:
 *   - Móvil:      ancho < 768 px
 *   - Tablet:     768 px ≤ ancho ≤ 1024 px
 *   - Escritorio: ancho > 1024 px
 */

import { useState, useEffect } from 'react';

// ── Breakpoints ───────────────────────────────────────────────────────────────
const BREAKPOINT_TABLET  = 768;
const BREAKPOINT_DESKTOP = 1024;

export interface UseResponsiveLayoutReturn {
  /** true si el ancho es menor a 768 px */
  isMobile: boolean;
  /** true si el ancho está entre 768 px y 1024 px (inclusive) */
  isTablet: boolean;
  /** true si el ancho es mayor a 1024 px */
  isDesktop: boolean;
  /** Ancho actual de la ventana en píxeles */
  width: number;
  /** Alto actual de la ventana en píxeles */
  height: number;
}

function getLayout(width: number): Pick<UseResponsiveLayoutReturn, 'isMobile' | 'isTablet' | 'isDesktop'> {
  if (width < BREAKPOINT_TABLET) {
    return { isMobile: true,  isTablet: false, isDesktop: false };
  }
  if (width <= BREAKPOINT_DESKTOP) {
    return { isMobile: false, isTablet: true,  isDesktop: false };
  }
  return { isMobile: false, isTablet: false, isDesktop: true };
}

export function useResponsiveLayout(): UseResponsiveLayoutReturn {
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>(() => ({
    width:  typeof window !== 'undefined' ? window.innerWidth  : BREAKPOINT_DESKTOP + 1,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  }));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      setDimensions({
        width:  window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return {
    ...getLayout(dimensions.width),
    width:  dimensions.width,
    height: dimensions.height,
  };
}
