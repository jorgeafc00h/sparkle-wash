// OcrSettingsService — persists vision-OCR provider config (Azure OpenAI
// gpt-4o or local Ollama llama3.2-vision). The active provider + both
// configs round-trip through the OS keychain so a user can switch between
// cloud and local without re-entering the other side's values.

interface AppApi {
  secureGet?: (service: string, account: string) => Promise<string | null>;
  secureSet?: (service: string, account: string, password: string) => Promise<void>;
  secureDelete?: (service: string, account: string) => Promise<boolean>;
}

const SERVICE = 'SparkleWashDesktop';
const ACCOUNT = 'azure_openai_vision_config';

function getApi(): AppApi | undefined {
  if (typeof window === 'undefined') return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI;
}

export type OcrProvider = 'azure' | 'ollama';

export interface AzureConfig {
  /** Full deployment endpoint URL — keep the `chat/completions` path + `api-version`
   *  query string the Azure portal provides, or the bare endpoint and we'll append. */
  endpoint: string;
  /** Azure deployment name (used when reconstructing endpoint from a bare host). */
  deployment: string;
  /** API key (treated as a secret). */
  apiKey: string;
  /** API version. Defaults to `2024-08-01-preview` (json_schema strict outputs). */
  apiVersion: string;
}

export interface OllamaConfig {
  /** Ollama HTTP base URL. Defaults to local install. */
  baseUrl: string;
  /** Vision-capable model tag (must be pulled in advance via `ollama pull`). */
  model: string;
}

export interface OcrSettings {
  provider: OcrProvider;
  azure: AzureConfig;
  ollama: OllamaConfig;
}

export const DEFAULT_API_VERSION = '2024-08-01-preview';
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
/** Suggested vision model. Must be pulled with `ollama pull llama3.2-vision:11b`
 *  before use. Alternatives: `llava:latest`, `bakllava:latest`. */
export const DEFAULT_OLLAMA_MODEL = 'llama3.2-vision:11b';

const DEFAULT_SETTINGS: OcrSettings = {
  provider: 'azure',
  azure: { endpoint: '', deployment: '', apiKey: '', apiVersion: DEFAULT_API_VERSION },
  ollama: { baseUrl: DEFAULT_OLLAMA_BASE_URL, model: DEFAULT_OLLAMA_MODEL },
};

// Backward-compat alias — keep so existing `OcrConfig` imports still resolve
// while we migrate callers. New code should use `AzureConfig` directly.
export type OcrConfig = AzureConfig;

export class OcrSettingsService {
  /** Returns the full settings bundle, with safe defaults for any missing keys. */
  static async getSettings(): Promise<OcrSettings> {
    const api = getApi();
    if (!api?.secureGet) return DEFAULT_SETTINGS;
    const raw = await api.secureGet(SERVICE, ACCOUNT);
    if (!raw) return DEFAULT_SETTINGS;
    try {
      const parsed = JSON.parse(raw) as Partial<OcrSettings> & {
        // Pre-tabs versions stored AzureConfig at the root — we honor that
        // shape so existing keychain entries upgrade transparently.
        endpoint?: string;
        deployment?: string;
        apiKey?: string;
        apiVersion?: string;
      };
      const azure: AzureConfig = parsed.azure ?? {
        endpoint: parsed.endpoint ?? '',
        deployment: parsed.deployment ?? '',
        apiKey: parsed.apiKey ?? '',
        apiVersion: parsed.apiVersion ?? DEFAULT_API_VERSION,
      };
      const ollama: OllamaConfig = parsed.ollama ?? {
        baseUrl: DEFAULT_OLLAMA_BASE_URL,
        model: DEFAULT_OLLAMA_MODEL,
      };
      const provider: OcrProvider =
        parsed.provider === 'ollama' ? 'ollama' : 'azure';
      return { provider, azure, ollama };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  static async setSettings(settings: OcrSettings): Promise<void> {
    const api = getApi();
    if (!api?.secureSet) {
      throw new Error('SecureStorage no disponible — abre la app en Electron.');
    }
    await api.secureSet(SERVICE, ACCOUNT, JSON.stringify(settings));
  }

  /** Convenience: change ONLY the active provider, leaving config untouched. */
  static async setActiveProvider(provider: OcrProvider): Promise<OcrSettings> {
    const current = await this.getSettings();
    const next: OcrSettings = { ...current, provider };
    await this.setSettings(next);
    return next;
  }

  /** Convenience: replace the Azure block, leaving the rest. */
  static async setAzure(config: AzureConfig): Promise<OcrSettings> {
    const current = await this.getSettings();
    const next: OcrSettings = { ...current, azure: config };
    await this.setSettings(next);
    return next;
  }

  /** Convenience: replace the Ollama block, leaving the rest. */
  static async setOllama(config: OllamaConfig): Promise<OcrSettings> {
    const current = await this.getSettings();
    const next: OcrSettings = { ...current, ollama: config };
    await this.setSettings(next);
    return next;
  }

  static async clear(): Promise<void> {
    const api = getApi();
    if (!api?.secureDelete) return;
    await api.secureDelete(SERVICE, ACCOUNT);
  }

  // ── Legacy API (single-config) ───────────────────────────────────────────
  // Kept so callers that don't care about provider switching keep compiling.
  // `get()` now returns the active provider's effective config when the
  // active provider is Azure, or null when Ollama is active (since the
  // legacy callers only know how to talk to Azure). New call-sites should
  // use `getSettings()` and dispatch on `provider` instead.

  static async get(): Promise<AzureConfig | null> {
    const settings = await this.getSettings();
    if (settings.provider !== 'azure') return null;
    if (!settings.azure.endpoint || !settings.azure.apiKey) return null;
    return settings.azure;
  }

  static async set(config: AzureConfig): Promise<void> {
    await this.setAzure(config);
  }

  /**
   * Build the full chat-completions URL from a stored Azure config.
   *
   * Accepts both forms the user might paste:
   *   - Bare resource: `https://<resource>.openai.azure.com`  → append the path.
   *   - Full deployment URL: `https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=...`
   *     → use it verbatim.
   */
  static buildChatUrl(config: AzureConfig): string {
    const trimmed = config.endpoint.trim().replace(/\/+$/, '');
    if (trimmed.includes('/chat/completions')) {
      return trimmed;
    }
    if (!config.deployment) {
      throw new Error('Falta el nombre del deployment de Azure OpenAI.');
    }
    return `${trimmed}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=${encodeURIComponent(config.apiVersion || DEFAULT_API_VERSION)}`;
  }

  /** Build Ollama's OpenAI-compatible chat URL from the stored base URL. */
  static buildOllamaChatUrl(config: OllamaConfig): string {
    const trimmed = config.baseUrl.trim().replace(/\/+$/, '');
    return `${trimmed}/v1/chat/completions`;
  }
}
