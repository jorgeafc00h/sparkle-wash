// PurchaseOcrService — extracts El Salvador purchase / invoice fields from
// images using either Azure OpenAI gpt-4o or a local Ollama vision model
// (e.g. llama3.2-vision:11b). Both paths route through the main process
// IPC bridges so neither the API key nor the localhost endpoint trips on
// CORS in Vite dev mode.

import {
  OcrSettingsService,
  type OcrProvider,
} from './OcrSettingsService';

interface AppApi {
  azureOpenAiFetch?: (config: {
    url: string;
    apiKey: string;
    body: unknown;
  }) => Promise<{ ok: boolean; status: number; body?: string; error?: string }>;
  ollamaFetch?: (config: {
    url: string;
    body: unknown;
  }) => Promise<{ ok: boolean; status: number; body?: string; error?: string }>;
}

function getApi(): AppApi | undefined {
  if (typeof window === 'undefined') return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI;
}

// Shape we ask the model to fill. Strict-mode json_schema requires every
// property to be listed in `required` and `additionalProperties: false`.
export interface ExtractedPurchase {
  documentType: 'factura' | 'ccf' | 'ticket' | 'otro';
  vendor: {
    name: string;
    nit: string;
    nrc: string;
  };
  documentNumber: string;
  codigoGeneracion: string;
  date: string; // YYYY-MM-DD; empty when not visible
  subtotal: number;
  iva: number;
  total: number;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  confidence: number; // 0-1, model's self-assessment
}

export interface ExtractionResult {
  ok: boolean;
  data?: ExtractedPurchase;
  /** Which provider answered — useful when surfacing errors to the user. */
  provider?: OcrProvider;
  /** Raw JSON the model produced — useful when parse fails. */
  rawText?: string;
  /** Empty when ok=true. */
  error?: string;
}

const SYSTEM_PROMPT = `Eres un experto en extracción de datos de comprobantes electrónicos del Ministerio de Hacienda de El Salvador (DTEs: Factura, CCF, Ticket).
Extrae los campos del documento en la imagen y devuelve JSON estricto siguiendo el esquema.

Reglas:
- Si un campo no es visible o no aplica, usa cadena vacía "" (para strings) o 0 (para números).
- La fecha debe estar en formato YYYY-MM-DD. Convierte 'DD/MM/AAAA' o 'AAAA-MM-DD' al formato pedido.
- NIT del proveedor: respeta el formato visible (puede ser NNNN-NNNNNN-NNN-N o 14 dígitos).
- NRC: solo dígitos.
- documentType: 'factura' (Factura Consumidor Final), 'ccf' (Crédito Fiscal), 'ticket' o 'otro'.
- codigoGeneracion: el UUID que aparece (a veces bajo el QR). Si no está, usa "".
- documentNumber: el número de control DTE-XX-... o el correlativo del ticket.
- Montos en USD. Si la imagen muestra solo total y no hay subtotal+IVA discriminados, calcula subtotal=total/1.13 e iva=total-subtotal redondeados a 2 decimales SOLO si es un CCF/Factura con IVA.
- confidence: tu certeza global (0.0–1.0).`;

const PURCHASE_SCHEMA = {
  type: 'object',
  properties: {
    documentType: {
      type: 'string',
      enum: ['factura', 'ccf', 'ticket', 'otro'],
    },
    vendor: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        nit: { type: 'string' },
        nrc: { type: 'string' },
      },
      required: ['name', 'nit', 'nrc'],
      additionalProperties: false,
    },
    documentNumber: { type: 'string' },
    codigoGeneracion: { type: 'string' },
    date: { type: 'string' },
    subtotal: { type: 'number' },
    iva: { type: 'number' },
    total: { type: 'number' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { type: 'number' },
          total: { type: 'number' },
        },
        required: ['description', 'quantity', 'unitPrice', 'total'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'number' },
  },
  required: [
    'documentType',
    'vendor',
    'documentNumber',
    'codigoGeneracion',
    'date',
    'subtotal',
    'iva',
    'total',
    'items',
    'confidence',
  ],
  additionalProperties: false,
} as const;

function buildMessages(imageDataUrl: string) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extrae los campos del documento mostrado y devuélvelos en JSON.',
        },
        {
          type: 'image_url',
          image_url: { url: imageDataUrl, detail: 'high' },
        },
      ],
    },
  ];
}

function safeParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Some local models occasionally wrap the JSON in code fences or include a
 * preamble even when asked for raw JSON. Strip the most common wrappers
 * before failing.
 */
function tolerantParseJson<T>(text: string): T | null {
  const trimmed = text.trim();
  const direct = safeParseJson<T>(trimmed);
  if (direct) return direct;
  // Strip ```json ... ``` or ``` ... ``` fences.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return safeParseJson<T>(fenceMatch[1].trim());
  }
  // Last-ditch: extract the first {...} block.
  const blockMatch = trimmed.match(/\{[\s\S]*\}/);
  if (blockMatch) {
    return safeParseJson<T>(blockMatch[0]);
  }
  return null;
}

export class PurchaseOcrService {
  /**
   * Extract structured purchase data from a single image. The image must be
   * a data URL (data:image/png;base64,...). Dispatches to whichever provider
   * is currently active in OcrSettings (Azure or Ollama).
   */
  static async extractFromImage(imageDataUrl: string): Promise<ExtractionResult> {
    const settings = await OcrSettingsService.getSettings();
    if (settings.provider === 'ollama') {
      return this.extractWithOllama(imageDataUrl, settings.ollama);
    }
    return this.extractWithAzure(imageDataUrl, settings.azure);
  }

  private static async extractWithAzure(
    imageDataUrl: string,
    config: { endpoint: string; deployment: string; apiKey: string; apiVersion: string },
  ): Promise<ExtractionResult> {
    if (!config.endpoint || !config.apiKey) {
      return {
        ok: false,
        provider: 'azure',
        error:
          'Azure OpenAI no está configurado. Pega endpoint + deployment + API key en Configuración → Compras → Azure OpenAI Vision.',
      };
    }
    const api = getApi();
    if (!api?.azureOpenAiFetch) {
      return {
        ok: false,
        provider: 'azure',
        error: 'Esta función solo está disponible en la app de escritorio.',
      };
    }
    let url: string;
    try {
      url = OcrSettingsService.buildChatUrl(config);
    } catch (err) {
      return {
        ok: false,
        provider: 'azure',
        error: err instanceof Error ? err.message : 'Configuración inválida',
      };
    }
    const body = {
      messages: buildMessages(imageDataUrl),
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'extracted_purchase',
          schema: PURCHASE_SCHEMA,
          strict: true,
        },
      },
      max_tokens: 1500,
      temperature: 0,
    };
    let response;
    try {
      response = await api.azureOpenAiFetch({ url, apiKey: config.apiKey, body });
    } catch (err) {
      return {
        ok: false,
        provider: 'azure',
        error: err instanceof Error ? err.message : 'Error de red',
      };
    }
    if (!response.ok) {
      let detail = response.error || `HTTP ${response.status}`;
      if (response.body) {
        const parsed = safeParseJson<{ error?: { message?: string } }>(response.body);
        detail = parsed?.error?.message ?? detail;
      }
      return { ok: false, provider: 'azure', error: detail, rawText: response.body };
    }
    const parsed = safeParseJson<{ choices?: Array<{ message?: { content?: string } }> }>(
      response.body ?? '',
    );
    const content = parsed?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      return {
        ok: false,
        provider: 'azure',
        error: 'Respuesta vacía o filtrada por el modelo.',
        rawText: response.body,
      };
    }
    const extracted = tolerantParseJson<ExtractedPurchase>(content);
    if (!extracted) {
      return {
        ok: false,
        provider: 'azure',
        error: 'El modelo devolvió JSON inválido (esperado por strict mode).',
        rawText: content,
      };
    }
    return { ok: true, provider: 'azure', data: extracted, rawText: content };
  }

  private static async extractWithOllama(
    imageDataUrl: string,
    config: { baseUrl: string; model: string },
  ): Promise<ExtractionResult> {
    if (!config.baseUrl || !config.model) {
      return {
        ok: false,
        provider: 'ollama',
        error:
          'Ollama no está configurado. Verifica baseUrl + model en Configuración → Compras → Ollama (local).',
      };
    }
    const api = getApi();
    if (!api?.ollamaFetch) {
      return {
        ok: false,
        provider: 'ollama',
        error: 'Esta función solo está disponible en la app de escritorio.',
      };
    }
    const url = OcrSettingsService.buildOllamaChatUrl(config);
    // Ollama's OpenAI-compat endpoint accepts the same chat-completions
    // shape, including image_url content parts. json_schema strict mode is
    // not universally supported across vision models in Ollama yet, so we
    // fall back to plain `json_object` mode and parse tolerantly.
    const body = {
      model: config.model,
      messages: buildMessages(imageDataUrl),
      response_format: { type: 'json_object' },
      temperature: 0,
      // Local models without strict-mode tend to ramble; cap output to
      // keep latency bounded.
      max_tokens: 1500,
    };
    let response;
    try {
      response = await api.ollamaFetch({ url, body });
    } catch (err) {
      return {
        ok: false,
        provider: 'ollama',
        error: err instanceof Error ? err.message : 'Error de red',
      };
    }
    if (!response.ok) {
      let detail = response.error || `HTTP ${response.status}`;
      if (response.body) {
        const parsed = safeParseJson<{ error?: { message?: string } | string }>(response.body);
        if (parsed) {
          detail =
            typeof parsed.error === 'string'
              ? parsed.error
              : parsed.error?.message ?? detail;
        }
      }
      // Friendly hint when Ollama isn't running at all (most common cause).
      if (response.status === 0 || /connect|refused|enotfound/i.test(detail)) {
        detail = `${detail} — ¿Está Ollama corriendo? (ollama serve)`;
      }
      return { ok: false, provider: 'ollama', error: detail, rawText: response.body };
    }
    const parsed = safeParseJson<{ choices?: Array<{ message?: { content?: string } }> }>(
      response.body ?? '',
    );
    const content = parsed?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      return {
        ok: false,
        provider: 'ollama',
        error: 'Respuesta vacía del modelo Ollama.',
        rawText: response.body,
      };
    }
    const extracted = tolerantParseJson<ExtractedPurchase>(content);
    if (!extracted) {
      return {
        ok: false,
        provider: 'ollama',
        error:
          'El modelo Ollama no devolvió JSON parseable. Intenta con un modelo más capaz (ej. llama3.2-vision:11b) o reformula la imagen.',
        rawText: content,
      };
    }
    return { ok: true, provider: 'ollama', data: extracted, rawText: content };
  }
}
