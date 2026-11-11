// ConsultaPublicaService — Consulta el API público del MH para verificar DTEs
// Portado desde la app React Native

import type { Compra } from '@/types/compras';
import { CompraSource } from '@/types/compras';
import { DTEJsonParser, type ParsedDTE } from './DTEJsonParser';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface ConsultaPublicaResponse {
  estadoDoc: string;           // "Transmitido Satisfactoriamente", "Invalidado", etc.
  descripcionEstado?: string;  // Texto largo que explica el estado (p.ej. motivo de invalidación)
  codGen: string;              // codigoGeneracion
  selloVal?: string;           // sello de recepción del MH
  tipoDte: string;
  nombDte: string;
  invalidacion?: {
    fechaHora?: string;
    tipo?: number;
    motivo?: string;
  };
  documento?: ParsedDTE;       // documento completo (endpoint /1)
}

// ── URLs ──────────────────────────────────────────────────────────────────────

const BASE_PROD = 'https://admin.factura.gob.sv/prod/consultas/publica/simple';
const BASE_TEST = 'https://admin.factura.gob.sv/test/consultas/publica/simple';
const PURCHASE_CONSULTA_AMBIENTE = '01';

// Compras (purchases) ALWAYS verify against the production consulta endpoint,
// regardless of the company's own environment flag. Real DTEs received from
// suppliers live on prod (admin.factura.gob.sv/prod/...), so a test-environment
// company would otherwise look up real DTEs in the wrong index and get no
// match. The `isProduction` parameter is kept on the public API for backward
// compatibility but is intentionally ignored — `BASE_TEST` is unreachable
// from this service.
function baseUrl(_isProduction: boolean): string {
  return BASE_PROD;
}

function isAcceptedEstado(estadoDoc?: string, invalidacion?: ConsultaPublicaResponse['invalidacion']): boolean {
  const rawEstado = (estadoDoc || '').trim();
  const estadoOk = /transmitido|procesado/i.test(rawEstado);
  const isInvalidated = /invalidad/i.test(rawEstado) || !!invalidacion;
  return estadoOk && !isInvalidated;
}
// Suppress unused-binding warning for BASE_TEST — kept for reference / future
// switch in case MH publishes a sandbox consulta endpoint we want to opt into.
void BASE_TEST;

// ── Servicio ──────────────────────────────────────────────────────────────────

export class ConsultaPublicaService {
  /**
   * Consulta el DTE completo en el portal del MH.
   * Retorna null si no se encuentra o hay un error de red.
   */
  static async lookupDTE(
    codigoGeneracion: string,
    fechaEmi: string,
    isProduction = true,
  ): Promise<ConsultaPublicaResponse | null> {
    try {
      const base = baseUrl(isProduction);
      // Purchases are supplier-issued real DTEs, so consulta publica must use
      // production both in the path and in the `ambiente` query parameter.
      const ambiente = PURCHASE_CONSULTA_AMBIENTE;
      const params = new URLSearchParams({ codigoGeneracion, fechaEmi, ambiente });
      const url = `${base}/1?${params.toString()}`;

      // Preferir el proxy IPC del main process en Electron dev — la API del MH
      // no incluye cabecera Access-Control-Allow-Origin, así que un fetch
      // directo desde http://localhost:5173 falla con "Failed to fetch" / CORS.
      // En producción (loaded via app://) y en web (si alguna vez se sirve
      // desde un dominio autorizado), el fetch normal funciona.
      const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

      let ok: boolean;
      let status: number;
      let bodyText: string;

      if (api?.consultaPublicaFetch) {
        const result = await api.consultaPublicaFetch(url);
        if (result.error) {
          console.error('ConsultaPublicaService.lookupDTE: IPC error', result.error);
          return null;
        }
        ok = result.ok;
        status = result.status;
        bodyText = result.body ?? '';
      } else {
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        ok = response.ok;
        status = response.status;
        bodyText = await response.text();
      }

      if (!ok) {
        if (status === 404) return null;
        console.warn(`ConsultaPublicaService: HTTP ${status} para ${codigoGeneracion}`);
        return null;
      }

      // El endpoint a veces responde con texto plano ante errores ("La fecha
      // no corresponde", "No se encontró"). Los parseamos como "no encontrado".
      const trimmed = bodyText.trim();
      if (!trimmed || !trimmed.startsWith('{')) {
        return null;
      }

      try {
        return JSON.parse(trimmed) as ConsultaPublicaResponse;
      } catch (parseErr) {
        console.warn('ConsultaPublicaService.lookupDTE: JSON inválido', parseErr);
        return null;
      }
    } catch (error) {
      console.error('ConsultaPublicaService.lookupDTE: error de red', error);
      return null;
    }
  }

  /**
   * Verifica si una compra existente está registrada en el MH. `verified` es
   * TRUE únicamente cuando Hacienda confirma que recibió el DTE (estadoDoc
   * "Transmitido Satisfactoriamente" / "Procesado"). Las diferencias de monto
   * NO afectan el flag — se exponen por separado para que la UI de detalle
   * las muestre.
   */
  static async verifyCompra(
    compra: Compra,
    isProduction = true,
  ): Promise<{
    verified: boolean;
    estado?: string;
    descripcion?: string;
    sello?: string;
    mhTotalPagar?: number;
    mhMontoTotalOperacion?: number;
    invalidatedAt?: string;
    invalidationReason?: string;
  }> {
    try {
      const result = await ConsultaPublicaService.lookupDTE(
        compra.codigoGeneracion,
        compra.fecha,
        isProduction,
      );

      if (!result) {
        return { verified: false, estado: 'NO_ENCONTRADO' };
      }

      const rawEstado = (result.estadoDoc || '').trim();

      return {
        verified: isAcceptedEstado(rawEstado, result.invalidacion),
        estado: rawEstado || undefined,
        descripcion: result.descripcionEstado,
        sello: result.selloVal,
        mhTotalPagar: result.documento?.resumen?.totalPagar,
        mhMontoTotalOperacion: result.documento?.resumen?.montoTotalOperacion,
        invalidatedAt: result.invalidacion?.fechaHora,
        invalidationReason: result.invalidacion?.motivo,
      };
    } catch (error) {
      console.error('ConsultaPublicaService.verifyCompra: error', error);
      return { verified: false, estado: 'ERROR' };
    }
  }

  /**
   * Importa un DTE desde el portal del MH como una nueva Compra.
   * Retorna null si no se encuentra el documento.
   */
  static async importFromConsultaPublica(
    codigoGeneracion: string,
    fechaEmi: string,
    companyId: string,
    isProduction = true,
  ): Promise<Compra | null> {
    try {
      const result = await ConsultaPublicaService.lookupDTE(
        codigoGeneracion,
        fechaEmi,
        isProduction,
      );

      if (!result || !result.documento) {
        console.warn('ConsultaPublicaService.importFromConsultaPublica: documento no disponible');
        return null;
      }

      // Enriquecer el documento con el sello de hacienda si no está en el DTE
      const dte: ParsedDTE = {
        ...result.documento,
        respuestaHacienda: {
          selloRecibido: result.selloVal,
          estado: result.estadoDoc,
        },
      };

      const compra = DTEJsonParser.parseDTEObject(
        dte,
        companyId,
        CompraSource.Manual,
        undefined,
        JSON.stringify(dte),
      );

      if (!compra) return null;

      // Marcar como verificado desde el origen solo si MH reporta un estado
      // aceptado y el documento no fue invalidado.
      return {
        ...compra,
        verified: isAcceptedEstado(result.estadoDoc, result.invalidacion),
        verifiedAt: new Date().toISOString(),
        verifiedEstado: result.estadoDoc,
        verifiedSello: result.selloVal,
      };
    } catch (error) {
      console.error('ConsultaPublicaService.importFromConsultaPublica: error', error);
      return null;
    }
  }
}
