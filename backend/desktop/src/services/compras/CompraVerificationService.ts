// CompraVerificationService — Verifica compras contra el portal del MH
// Portado desde la app React Native

import type { Compra } from '@/types/compras';
import { isInternalUseCompra } from '@/types/compras';
import { ConsultaPublicaService } from './ConsultaPublicaService';

export class CompraVerificationService {
  /**
   * Verifica una compra individual contra el portal público del MH.
   * Actualiza los campos verified, verifiedAt, verifiedEstado y verifiedSello.
   */
  static async verifyCompra(
    compra: Compra,
    isProduction = true,
  ): Promise<Compra> {
    // Uso interno: no es un DTE nacional, no hay nada que consultar en el MH.
    if (isInternalUseCompra(compra)) return compra;
    try {
      const result = await ConsultaPublicaService.verifyCompra(compra, isProduction);
      const now = new Date().toISOString();

      return {
        ...compra,
        verified: result.verified,
        verifiedAt: now,
        verifiedEstado: result.estado,
        verifiedDescripcion: result.descripcion,
        verifiedSello: result.sello,
        mhTotalPagar: result.mhTotalPagar,
        mhMontoTotalOperacion: result.mhMontoTotalOperacion,
        invalidatedAt: result.invalidatedAt,
        invalidationReason: result.invalidationReason,
        updatedAt: now,
      };
    } catch (error) {
      console.error('CompraVerificationService.verifyCompra: error', error);
      // Retornar la compra sin modificar en caso de error de red
      return compra;
    }
  }

  /**
   * Verifica un lote de compras con reporte de progreso.
   * Agrega un pequeño delay entre peticiones para no saturar el API del MH.
   */
  static async verifyBatch(
    compras: Compra[],
    isProduction = true,
    onProgress?: (current: number, total: number) => void,
  ): Promise<Compra[]> {
    const results: Compra[] = [];
    // Los registros de uso interno se omiten (se devuelven sin tocar).
    const total = compras.length;

    for (let i = 0; i < total; i++) {
      const compra = compras[i];
      if (isInternalUseCompra(compra)) {
        results.push(compra);
        onProgress?.(i + 1, total);
        continue;
      }
      try {
        const verified = await CompraVerificationService.verifyCompra(compra, isProduction);
        results.push(verified);
      } catch (error) {
        console.warn(
          `CompraVerificationService.verifyBatch: error en compra ${compra.id}`,
          error,
        );
        results.push(compra);
      }

      onProgress?.(i + 1, total);

      // Pausa de 300ms entre peticiones para respetar rate limits del MH
      if (i < total - 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    return results;
  }
}
