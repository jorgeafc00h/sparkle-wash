export const CHAT_SIGN_IN_REQUIRED_MESSAGE = 'Inicia sesión para usar el chat de soporte.';

type ChatAccessMode = 'apikey' | 'none';

export class ChatAuthService {
  private readonly apiKey: string;

  constructor(_apiBaseUrl: string, apiKey: string) {
    this.apiKey = apiKey.trim();
  }

  getAccessMode(): ChatAccessMode {
    if (this.apiKey) {
      return 'apikey';
    }

    return 'none';
  }

  supportsGuestAccess(): boolean {
    return this.getAccessMode() === 'apikey';
  }

  invalidate(): void {
    // API-key auth is stateless; keep this method for existing callers.
  }

  async getRequestHeaders(options?: {
    includeContentType?: boolean;
    allowAnonymous?: boolean;
  }): Promise<Record<string, string>> {
    const {
      includeContentType = true,
      allowAnonymous = false,
    } = options ?? {};

    const headers: Record<string, string> = {};
    if (includeContentType) {
      headers['Content-Type'] = 'application/json';
    }

    if (allowAnonymous) {
      return headers;
    }

    if (this.getAccessMode() !== 'apikey') {
      throw new Error(CHAT_SIGN_IN_REQUIRED_MESSAGE);
    }

    headers['X-API-Key'] = this.apiKey;
    return headers;
  }
}

export default ChatAuthService;
