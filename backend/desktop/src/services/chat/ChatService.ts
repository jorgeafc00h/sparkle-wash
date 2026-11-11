import type {
  ChatApiCitation,
  ChatApiMessage,
  ChatApiResponse,
  ChatApiSession,
  ChatCompletionResponse,
  ChatConfiguration,
  ChatMessage,
  ChatSession,
  CreateChatSessionInput,
  DocumentUploadStatus,
  MessageResponse,
  SessionResponse,
  UploadResponse,
} from '../../types/chat';
import ChatAuthService from './ChatAuthService';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CHAT_API_KEY = 'fs-web-client-2025-secret-key';

function buildConfig(): ChatConfiguration {
  const apiBaseUrl =
    import.meta.env.VITE_CHAT_API_URL ??
    'https://k-chat-api-prod.azurewebsites.net';
  return {
    apiBaseUrl,
    signalrUrl: `${apiBaseUrl}/chathub`,
    apiKey: import.meta.env.VITE_CHAT_API_KEY ?? DEFAULT_CHAT_API_KEY,
    timeout: DEFAULT_TIMEOUT_MS,
    maxRetries: 2,
  };
}

class ChatService {
  private readonly config: ChatConfiguration;
  private readonly authService: ChatAuthService;

  constructor() {
    this.config = buildConfig();
    this.authService = new ChatAuthService(this.config.apiBaseUrl, this.config.apiKey);
  }

  supportsGuestAccess(): boolean {
    return this.authService.supportsGuestAccess();
  }

  invalidateAuth(): void {
    this.authService.invalidate();
  }

  async getSignalRAccessToken(): Promise<string | null> {
    return null;
  }

  getSignalRUrl(): string {
    const separator = this.config.signalrUrl.includes('?') ? '&' : '?';
    return `${this.config.signalrUrl}${separator}api_key=${encodeURIComponent(this.config.apiKey)}`;
  }

  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      auth?: 'auto' | 'none';
      response?: 'api' | 'plain';
      includeContentType?: boolean;
    },
  ): Promise<T> {
    const {
      body,
      auth = 'auto',
      response = 'api',
      includeContentType = true,
    } = options ?? {};

    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const headers = auth === 'none'
        ? await this.authService.getRequestHeaders({
            allowAnonymous: true,
            includeContentType,
          })
        : await this.authService.getRequestHeaders({ includeContentType });

      const url = `${this.config.apiBaseUrl}${path}`;
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(await this.getErrorMessage(res));
      }

      const payload = await res.json();
      if (response === 'plain') {
        return payload as T;
      }

      const envelope = payload as ChatApiResponse<T>;
      if (!envelope.success || envelope.data === undefined) {
        throw new Error(envelope.message || 'El servicio de chat devolvió una respuesta inválida.');
      }

      return envelope.data;
    } finally {
      clearTimeout(timerId);
    }
  }

  private async getErrorMessage(res: Response): Promise<string> {
    let message = `Error ${res.status}`;
    try {
      const data = await res.json();
      message = data?.message ?? data?.error ?? message;
    } catch {
      // ignore JSON parse failures and keep the fallback message
    }
    return message;
  }

  private normalizeCitation(citation: ChatApiCitation): { title: string; source: string } {
    const title = citation.filename
      ? `${citation.filename} p.${citation.pageNumber}`
      : `Página ${citation.pageNumber}`;
    const source = citation.quote || citation.fullMatch || '';
    return { title, source };
  }

  private normalizeMessage(message: ChatApiMessage): ChatMessage {
    return {
      id: message.id,
      sessionId: message.sessionId,
      role: (message.role || 'assistant') as ChatMessage['role'],
      content: message.content,
      timestamp: message.timestamp,
      citations: (message.citations ?? []).map((citation) => this.normalizeCitation(citation)),
      metadata: message.metadata,
    };
  }

  private normalizeCompletionResponse(
    sessionId: string,
    response: ChatCompletionResponse,
  ): ChatMessage {
    return {
      id: response.messageId,
      sessionId,
      role: 'assistant',
      content: response.content,
      timestamp: response.timestamp,
      citations: (response.citations ?? []).map((citation) => this.normalizeCitation(citation)),
    };
  }

  private normalizeSession(session: ChatApiSession): ChatSession {
    return {
      id: session.id,
      userId: session.userId,
      title: session.title,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      isActive: session.isActive,
      messages: (session.messages ?? []).map((message) => this.normalizeMessage(message)),
      metadata: session.metadata,
    };
  }

  /** Verify the API is reachable. Returns true if healthy. */
  async testConnection(): Promise<boolean> {
    try {
      const data = await this.request<{ status?: string; Status?: string }>(
        'GET',
        '/health',
        { auth: 'none', response: 'plain', includeContentType: false },
      );
      const status = data.status ?? data.Status;
      return String(status ?? '').toLowerCase() === 'healthy';
    } catch {
      return false;
    }
  }

  async createSession(input: CreateChatSessionInput): Promise<SessionResponse> {
    try {
      const data = await this.request<ChatApiSession>('POST', '/api/chat/sessions', {
        body: {
          userId: input.userId,
          title: input.title ?? 'Nueva sesión',
          contactName: input.contactName,
          channel: input.channel ?? 'chat',
          metadata: input.metadata ?? {},
        },
      });

      return { success: true, data: this.normalizeSession(data) };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }

  async getSession(sessionId: string): Promise<SessionResponse> {
    try {
      const data = await this.request<ChatApiSession>('GET', `/api/chat/sessions/${sessionId}`);
      return { success: true, data: this.normalizeSession(data) };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }

  async getMessages(sessionId: string): Promise<{ success: boolean; data?: ChatMessage[]; message?: string }> {
    try {
      const session = await this.request<ChatApiSession>('GET', `/api/chat/sessions/${sessionId}`);
      return {
        success: true,
        data: (session.messages ?? []).map((message) => this.normalizeMessage(message)),
      };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }

  async sendMessage(
    sessionId: string,
    message: string,
  ): Promise<MessageResponse> {
    try {
      const data = await this.request<ChatCompletionResponse>(
        'POST',
        `/api/chat/sessions/${sessionId}/messages`,
        {
          body: {
            sessionId,
            message,
          },
        },
      );

      return {
        success: true,
        data: this.normalizeCompletionResponse(sessionId, data),
      };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }

  async uploadDocument(file: File): Promise<UploadResponse> {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), 60_000);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${this.config.apiBaseUrl}/api/document/ingest`, {
        method: 'POST',
        headers: await this.authService.getRequestHeaders({ includeContentType: false }),
        body: formData,
        signal: controller.signal,
      });

      if (!res.ok) {
        return { success: false, message: await this.getErrorMessage(res) };
      }

      const payload = await res.json() as ChatApiResponse<DocumentUploadStatus>;
      if (!payload.success || !payload.data) {
        return {
          success: false,
          message: payload.message || 'No se pudo procesar el documento.',
        };
      }

      return { success: true, data: payload.data };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    } finally {
      clearTimeout(timerId);
    }
  }
}

// Singleton
export const chatService = new ChatService();
export default ChatService;
